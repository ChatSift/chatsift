import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { formatCaseUserTag } from '@chatsift/core';
import type { AutomoderatorGuildSettings, AutomoderatorLogWebhooks } from '@chatsift/db';
import type { Client } from '@discordjs/core';
import { GatewayDispatchEvents } from '@discordjs/core';
import { executeAction } from './actionExecutor.js';
import type { BurstMessage } from './antispam.js';
import { recordMessage, resolveAntispamSettings } from './antispam.js';
import { findBypassRole } from './bypassRoles.js';
import { traceDecision } from './decisionTrace.js';
import type { RunnerFilterKind } from './filterExemptions.js';
import { findFilterExemptions } from './filterExemptions.js';
import type { FilterImmunity } from './filterImmunity.js';
import { findFilterImmunity } from './filterImmunity.js';
import { dispatchLog, getLogWebhook, LOG_TYPE } from './guildLog.js';
import type { FilterOutcome } from './guildLogFormat.js';
import { buildFilterHitEmbed } from './guildLogFormat.js';
import { runInviteFilter } from './inviteFilter.js';
import type { CacheableMessage, LoggableMessage } from './messageCache.js';
import { isLoggableMessage } from './messageCache.js';
import { featureInvocations, filterHits } from './metrics.js';
import type { TriggerLadderResult } from './triggerLadder.js';
import { applyTriggerLadder } from './triggerLadder.js';
import { runUrlFilter } from './urlFilter.js';

/**
 * The message filter pipeline (P5b/P5c, features 02, 03, 07 and 09) -- the half of the port that does its own
 * matching, as opposed to the banword path in `automodIntake.ts` where Discord matches and this bot only
 * responds.
 *
 * Legacy ran this as a separate `services/automod` process fed over AMQP, with a
 * transform/check/run/cleanup/log interface per runner. The shape survives; the process boundary and the interface do not. Three
 * runners with three lifecycle hooks apiece is a framework built for a plugin system nobody ever wrote a plugin
 * for, and the port has no broker for it to sit behind.
 *
 * **No runner here files a case.** A hit deletes and tells the member why; the punishment, if any, comes from
 * the trigger ladder (P5c, feature 11), which counts hits per member and escalates on the count. That is the
 * shape that makes sense for something a member can do by accident once.
 */
const FEATURE: Record<RunnerFilterKind, string> = {
	URLS: 'url_filter',
	INVITES: 'invite_filter',
	ANTISPAM: 'antispam',
};

/**
 * `filter_hits_total`'s label per runner, matching the `words` value `automodIntake.ts` already writes. Spelled
 * out rather than derived from the enum value, because a metric label is an interface a dashboard is built
 * against -- `.toLowerCase()` would let a schema rename silently break every panel.
 */
const HIT_LABEL: Record<RunnerFilterKind, string> = {
	URLS: 'urls',
	INVITES: 'invites',
	ANTISPAM: 'antispam',
};

/**
 * What the filter log calls each runner, and what the DM tells the member. Two strings rather than one because
 * a log read by staff wants the filter's name and a DM read by the member wants the reason in their own terms.
 */
const FILTER_LABEL: Record<RunnerFilterKind, { readonly dm: string; readonly log: string }> = {
	URLS: { log: 'URL filter', dm: "it contained a link that isn't allowed here" },
	INVITES: { log: 'Invite filter', dm: "it contained an invite to a server that isn't allowed here" },
	ANTISPAM: { log: 'Anti-spam', dm: 'you sent too many messages too quickly' },
};

/**
 * What actually became of the message. Named states rather than a bare boolean, because a delete Discord
 * refused has to read differently everywhere below -- a message the bot had lost Manage Messages on must not be
 * logged as "Message deleted", nor its author DMed that it had been removed, while it sits there in the
 * channel.
 */
type DeleteOutcome = 'deleted' | 'failed';

/**
 * Count-aware because anti-spam removes a whole burst, not one message -- a log line saying "Message deleted"
 * for a six-message flood understates what the bot just did to the channel.
 */
function describeDelete(outcome: DeleteOutcome, count: number): string {
	const noun = count === 1 ? 'the message' : `${count} messages`;

	switch (outcome) {
		case 'deleted':
			return count === 1 ? 'Message deleted' : `${count} messages deleted`;
		// Said plainly in the log staff read, because this is the one outcome they have to do something about --
		// it is almost always a missing Manage Messages in that channel.
		case 'failed':
			return `Could not delete ${noun}: check my permissions in that channel`;
	}
}

export interface FilterVerdict {
	readonly kind: RunnerFilterKind;
	/**
	 * The hosts or invite codes that tripped it, in the order they appeared in the message. Anti-spam has no
	 * matched *content* -- what tripped it is a rate -- so it carries one line describing the burst instead.
	 */
	readonly matched: string[];
	/**
	 * Messages this verdict wants removed **besides** the one being filtered. Only anti-spam sets it: the
	 * offending thing is the burst, and deleting only the message that tipped it over leaves the spam in place.
	 */
	readonly messages?: readonly BurstMessage[];
}

/**
 * Everything the pipeline decided, including the reasons it decided nothing.
 *
 * The gates are reported even when they stopped the evaluation, because that is what `/simulate` exists to show
 * and what the decision trace records -- "the filter is off", "the category is exempt" and "no match" are three
 * different answers to "why wasn't this deleted" and a boolean collapses them into one.
 */
export interface FilterEvaluation {
	/**
	 * The bypass role that stopped every runner, if one did. Non-null implies `verdicts` is empty.
	 */
	readonly bypassRoleId: string | null;
	/**
	 * Filters the guild has turned on. A filter absent from here was never consulted.
	 */
	readonly enabled: RunnerFilterKind[];
	/**
	 * Per filter, the exempt channel that covers this message's channel -- the channel itself, its parent, or
	 * the category. A filter present here did not run.
	 */
	readonly exemptions: Map<RunnerFilterKind, string>;
	/**
	 * The status that stopped every runner, if one did: the owner, or a member holding Administrator or Manage
	 * Messages. Reported separately from `bypassRoleId` because it is *status* rather than configuration --
	 * "why wasn't this deleted" has a different answer and a different fix in each case.
	 */
	readonly immunity: FilterImmunity | null;
	readonly verdicts: FilterVerdict[];
}

/**
 * Where the message being evaluated lives. Null for `/simulate`, which has text but no message, and null for a
 * `MESSAGE_UPDATE` -- see `RUNNERS.ANTISPAM` for the one runner that cares, and `filterMessage` for why an edit
 * deliberately withholds it.
 *
 * The *author* is not part of this: they are known on every path this runs on, including the edits that carry
 * no message identity, and the permission gates need them there.
 */
export interface FilterMessageIdentity {
	readonly channelId: string;
	readonly messageId: string;
}

type FilterSettings = Pick<
	AutomoderatorGuildSettings,
	'antispamAmount' | 'antispamTime' | 'useInviteFilters' | 'useUrlFilters'
>;

interface RunnerInput {
	readonly authorId: string | null;
	readonly content: string;
	readonly guildId: string;
	readonly message: FilterMessageIdentity | null;
	readonly settings: FilterSettings;
}

interface RunnerHit {
	readonly matched: string[];
	readonly messages?: readonly BurstMessage[];
}

const RUNNERS: Record<RunnerFilterKind, (input: RunnerInput) => Promise<RunnerHit | null>> = {
	async URLS({ guildId, content }) {
		const hit = await runUrlFilter(guildId, content);
		return hit && { matched: hit.forbidden };
	},
	async INVITES({ guildId, content }) {
		const hit = await runInviteFilter(guildId, content);
		return hit && { matched: hit.forbidden };
	},
	/**
	 * The one runner that is about a rate rather than about content, which is why it is the one that needs the
	 * message's identity.
	 *
	 * **Returns null outright for `/simulate`**, which passes no message. The command says so in its own words
	 * rather than reporting "nothing matched": recording a hypothetical message would corrupt the real window,
	 * and reporting the moderator's own recent message rate answers a question nobody asked.
	 */
	async ANTISPAM({ authorId, guildId, message, settings }) {
		const antispam = resolveAntispamSettings(settings);
		if (!antispam || !message || !authorId) {
			return null;
		}

		const hit = await recordMessage(
			guildId,
			authorId,
			{ channelId: message.channelId, messageId: message.messageId },
			antispam,
		);

		return (
			hit && {
				matched: [`${hit.messages.length} messages in ${antispam.windowSeconds}s`],
				messages: hit.messages,
			}
		);
	},
};

export interface FilterEvaluationInput {
	/**
	 * Who posted it. Null only for `/simulate`, which has no author to check permissions for -- and says so in
	 * its reply rather than reporting a moderator as immune.
	 */
	readonly authorId: string | null;
	readonly channelId: string;
	readonly content: string;
	readonly guildId: string;
	/**
	 * The message itself, when there is one. Absent for `/simulate`.
	 */
	readonly message?: FilterMessageIdentity | undefined;
	/**
	 * The author's roles, for the bypass check.
	 *
	 * A thunk rather than an array because resolving them can cost a REST call and almost never needs to: a
	 * `MESSAGE_CREATE` carries the member object, but a `MESSAGE_UPDATE` need not, and a staff member editing a
	 * message must not lose their bypass because of which event delivered it. Deferring the resolution means the
	 * fetch only happens for a guild that has a filter on *and* an edit that arrived without a member.
	 *
	 * `/simulate` returns an empty list deliberately -- the question it answers is "would this message be
	 * deleted", and a moderator running it necessarily holds the roles that would let them off.
	 */
	resolveRoleIds(): Promise<readonly string[]>;
}

/**
 * Decides what the filters make of a message.
 *
 * **No Discord side effects at all** -- no delete, no DM, no log. Split out so `/simulate` runs the identical
 * decision path rather than an approximation of it. A simulator that reimplements the thing it simulates is a
 * simulator that agrees with production right up until the moment somebody needs it to.
 *
 * Anti-spam is the one runner that is not *purely* a decision: it records the message in its sliding window, so
 * calling this on a real message advances that member's count. `/simulate` passes no message, which is what
 * keeps a simulation from writing into the real window.
 *
 * The gates are evaluated cheapest-first, and each one that stops the evaluation stops it before the next costs
 * anything: extraction is free, the settings read is one indexed row, the bypass and exemption reads are one
 * small query each, and only then does a runner resolve invites over REST.
 */
export async function evaluateFilters(input: FilterEvaluationInput): Promise<FilterEvaluation> {
	const { guildId, channelId, content } = input;

	const [settings] = await getContext().db<FilterSettings[]>`
		SELECT use_url_filters, use_invite_filters, antispam_amount, antispam_time
		FROM automoderator_guild_settings WHERE guild_id = ${guildId}
	`;

	const enabled: RunnerFilterKind[] = [];
	if (settings?.useUrlFilters) {
		enabled.push('URLS');
	}

	if (settings?.useInviteFilters) {
		enabled.push('INVITES');
	}

	// No `use_antispam` flag beside the thresholds: both being set is what turns it on, which is legacy's rule
	// and the honest one -- "anti-spam on, no threshold" is not a configuration a guild can mean.
	if (settings && resolveAntispamSettings(settings)) {
		enabled.push('ANTISPAM');
	}

	const empty: FilterEvaluation = {
		enabled,
		bypassRoleId: null,
		immunity: null,
		exemptions: new Map(),
		verdicts: [],
	};

	if (enabled.length === 0) {
		return empty;
	}

	// Resolved once for both permission gates below.
	const roleIds = await input.resolveRoleIds();

	// Above the guild's configuration entirely: the owner and staff are never filtered, whatever the bypass
	// roles say. See `filterImmunity.ts` -- the owner half is not a policy choice, because every punishment the
	// ladder could reach for is one Discord refuses to carry out against them.
	const immunity = input.authorId === null ? null : await findFilterImmunity(guildId, input.authorId, roleIds);
	if (immunity) {
		return { ...empty, immunity };
	}

	// Before the exemption read and before any runner: a bypass role stops all of them at once, so paying for
	// the per-filter work first would be paying for an answer already known. It also keeps a staff member's
	// messages out of the anti-spam window entirely, rather than accumulating a burst that can never trip.
	const bypassRoleId = await findBypassRole(guildId, roleIds);
	if (bypassRoleId) {
		return { ...empty, bypassRoleId };
	}

	const exemptions = await findFilterExemptions(guildId, channelId, enabled);
	const applicable = enabled.filter((kind) => !exemptions.has(kind));

	const runnerInput: RunnerInput = {
		guildId,
		content,
		authorId: input.authorId,
		message: input.message ?? null,
		settings: settings!,
	};

	const results = await Promise.all(
		applicable.map(async (kind) => ({ kind, hit: await RUNNERS[kind](runnerInput) })),
	);

	const verdicts = results
		.filter((result): result is { hit: RunnerHit; kind: RunnerFilterKind } => result.hit !== null)
		.map(({ kind, hit }) => ({ kind, matched: hit.matched, ...(hit.messages ? { messages: hit.messages } : {}) }));

	return { enabled, bypassRoleId: null, immunity: null, exemptions, verdicts };
}

export function registerFilterRunner(client: Client): void {
	client.on(GatewayDispatchEvents.MessageCreate, async ({ data }) => {
		await handle(data, 'messageCreate');
	});

	// Re-run on edit, as legacy did: posting an innocuous message and editing a link into it is the evasion this
	// closes, and it costs nothing for the overwhelming majority of edits, which carry no link at all.
	client.on(GatewayDispatchEvents.MessageUpdate, async ({ data }) => {
		await handle(data, 'messageUpdate');
	});
}

async function handle(data: CacheableMessage & { member?: { roles: string[] } }, event: string): Promise<void> {
	// Read before the narrowing below, which drops it: `member` is not part of the shape `isLoggableMessage`
	// asserts, because nothing else in this service needs it.
	const payloadRoles = data.member?.roles;

	// Narrows the payload as well as excluding bots and webhooks -- the same gate the message log uses, for the
	// same reason: a reduced `MESSAGE_UPDATE` with no `content` must not be evaluated as an empty message.
	if (!isLoggableMessage(data)) {
		return;
	}

	const logger = getContext().logger.child({ event, guildId: data.guild_id });

	try {
		await filterMessage(data, payloadRoles, event === 'messageCreate', logger);
	} catch (error) {
		featureInvocations.inc({ feature: 'filters', outcome: 'failed' });
		logger.error({ err: error, messageId: data.id }, 'failed to run the message filters');
	}
}

/**
 * The author's roles, from the payload when it carried them and from Discord when it did not.
 *
 * A failed fetch resolves to no roles, which fails the bypass check **open** -- the same direction, and the
 * same reasoning, as `automodIntake.ts`'s member lookup: an unreadable member must not silently disable the
 * filter for everybody.
 */
async function resolveAuthorRoles(
	message: LoggableMessage,
	payloadRoles: string[] | undefined,
	logger: Logger,
): Promise<readonly string[]> {
	if (payloadRoles) {
		return payloadRoles;
	}

	try {
		const member = await getContext().service.client.api.guilds.getMember(message.guild_id, message.author.id);
		return member.roles;
	} catch (error) {
		logger.info({ err: error, targetId: message.author.id }, 'could not read the author of a filtered message');
		return [];
	}
}

async function filterMessage(
	message: LoggableMessage,
	payloadRoles: string[] | undefined,
	isNewMessage: boolean,
	logger: Logger,
): Promise<void> {
	const evaluation = await evaluateFilters({
		guildId: message.guild_id,
		channelId: message.channel_id,
		content: message.content,
		authorId: message.author.id,
		// **Only a new message counts toward anti-spam.** An edit is not another message, and feeding edits into
		// the window would let somebody be muted for fixing three typos -- while the content filters still have
		// to re-run on edits, which is the evasion they close.
		...(isNewMessage ? { message: { channelId: message.channel_id, messageId: message.id } } : {}),
		async resolveRoleIds() {
			return resolveAuthorRoles(message, payloadRoles, logger);
		},
	});

	const traceBase = { guildId: message.guild_id, targetId: message.author.id };

	// Deliberately uncounted: a guild that has never turned a filter on is not "skipping" one, and counting it
	// would bury the outcomes that mean something under every message the bot has ever seen.
	if (evaluation.enabled.length === 0) {
		return;
	}

	if (evaluation.immunity) {
		traceDecision(logger, { ...traceBase, runner: 'filters', action: null, immunity: evaluation.immunity });
		featureInvocations.inc({ feature: 'filters', outcome: 'skipped' });
		return;
	}

	if (evaluation.bypassRoleId) {
		traceDecision(logger, { ...traceBase, runner: 'filters', action: null, bypassRoleId: evaluation.bypassRoleId });
		featureInvocations.inc({ feature: 'filters', outcome: 'skipped' });
		return;
	}

	for (const [kind, exemptChannelId] of evaluation.exemptions) {
		traceDecision(logger, { ...traceBase, runner: FEATURE[kind], action: null, exemption: exemptChannelId });
		featureInvocations.inc({ feature: FEATURE[kind], outcome: 'skipped' });
	}

	if (evaluation.verdicts.length === 0) {
		return;
	}

	for (const verdict of evaluation.verdicts) {
		filterHits.inc({ filter: HIT_LABEL[verdict.kind] });
	}

	// One delete pass for the message no matter how many filters caught it -- two runners tripping on one
	// message is one deletion and one DM, not two of each. Anti-spam widens the *set* rather than adding a pass.
	const targets = collectTargets(message, evaluation.verdicts);
	const outcome = await deleteMessages(message, targets, evaluation.verdicts, logger);

	// Only when the messages are actually gone. Telling somebody their message was removed while it is still
	// sitting in the channel is worse than saying nothing.
	if (outcome === 'deleted') {
		await notifyAuthor(message, evaluation.verdicts, logger);
	}

	for (const verdict of evaluation.verdicts) {
		traceDecision(logger, {
			...traceBase,
			runner: FEATURE[verdict.kind],
			action: 'delete',
			matched: verdict.matched.join(', '),
		});
		// A delete Discord refused is a failure, not an application -- the guild configured something and it did
		// not happen.
		featureInvocations.inc({ feature: FEATURE[verdict.kind], outcome: outcome === 'failed' ? 'failed' : 'applied' });
	}

	// After the delete, so the log can say what the deletion and the escalation did in one embed -- and gated on
	// it, because a delete Discord refused leaves the offending messages sitting in the channel. Banning somebody
	// over a message everyone can still read, without even the DM that this path suppresses for the same reason,
	// is the worse of the two failures; the log line already says to check the bot's permissions, which is the
	// part staff can act on.
	let ladder: TriggerLadderResult | null = null;
	let ladderFailed = false;

	if (outcome !== 'failed') {
		try {
			ladder = await applyTriggerLadder(
				{
					guildId: message.guild_id,
					messageId: message.id,
					target: { id: message.author.id, tag: formatCaseUserTag(message.author) },
				},
				logger,
			);
		} catch (error) {
			// A rung Discord refused -- a target above the bot in the role hierarchy is the case that survives now
			// that `filterImmunity.ts` covers the owner. Caught here rather than left to propagate because
			// everything above already happened: without this, the messages were deleted and the member DMed, and
			// then the throw unwound past the filter log, so staff got no record of any of it.
			ladderFailed = true;
			logger.warn(
				{ err: error, targetId: message.author.id },
				'could not carry out the trigger ladder punishment',
			);
		}
	}

	const webhook = await getLogWebhook(message.guild_id, LOG_TYPE.FILTER);
	if (webhook) {
		const summary = [
			describeDelete(outcome, targets.length),
			ladder?.summary,
			// Said in the log rather than only in ours, for the same reason a failed delete is: it is a
			// configuration problem staff have to fix, and it is invisible to them otherwise.
			ladderFailed ? 'Could not carry out the escalation: check my role position' : null,
		]
			.filter(Boolean)
			.join(' • ');

		await postFilterLog(
			webhook,
			message,
			evaluation.verdicts,
			{ summary, ...(ladder?.caseRef === undefined ? {} : { caseRef: ladder.caseRef }) },
			logger,
		);
	}
}

/**
 * Every message this pass should remove, deduplicated: the one that was filtered, plus anti-spam's burst, which
 * already contains it. Deduplicated on the id alone rather than on the pair, because a message has one channel
 * and a duplicate id in a bulk delete is a request Discord rejects outright.
 */
function collectTargets(message: LoggableMessage, verdicts: FilterVerdict[]): BurstMessage[] {
	const byId = new Map<string, BurstMessage>([
		[message.id, { channelId: message.channel_id, messageId: message.id }],
	]);

	for (const verdict of verdicts) {
		for (const burst of verdict.messages ?? []) {
			byId.set(burst.messageId, burst);
		}
	}

	return [...byId.values()];
}

/**
 * Discord's own ceiling on a bulk delete. Anti-spam cannot configure a burst larger than this
 * (`ANTISPAM_MAX_AMOUNT` is the same number), but a message caught by anti-spam *and* another runner could in
 * principle add one, so the chunking is here rather than assumed away.
 */
const BULK_DELETE_MAX = 100;

async function deleteMessages(
	message: LoggableMessage,
	targets: BurstMessage[],
	verdicts: FilterVerdict[],
	logger: Logger,
): Promise<DeleteOutcome> {
	const api = getContext().service.client.api;
	const reason = `${verdicts.map((verdict) => FILTER_LABEL[verdict.kind].log).join(' + ')} trigger`;

	// Grouped by channel because a burst spans however many channels the member posted in, and bulk delete is a
	// per-channel endpoint.
	const byChannel = new Map<string, string[]>();
	for (const target of targets) {
		byChannel.set(target.channelId, [...(byChannel.get(target.channelId) ?? []), target.messageId]);
	}

	try {
		await executeAction(
			{
				action: 'delete',
				guildId: message.guild_id,
				source: 'automod',
				targetId: message.author.id,
				decidedBy: verdicts.map((verdict) => verdict.matched.join(', ')).join(' | '),
				async execute() {
					await Promise.all(
						[...byChannel].map(async ([channelId, ids]) => {
							// Bulk delete refuses a single-message body, so one message is a plain delete. This is also
							// the overwhelmingly common case -- every URL and invite hit is exactly one message.
							if (ids.length === 1) {
								await api.channels.deleteMessage(channelId, ids[0]!, { reason });
								return;
							}

							for (let index = 0; index < ids.length; index += BULK_DELETE_MAX) {
								await api.channels.bulkDeleteMessages(channelId, ids.slice(index, index + BULK_DELETE_MAX), {
									reason,
								});
							}
						}),
					);
				},
			},
			logger,
		);

		return 'deleted';
	} catch (error) {
		// A message somebody else already deleted, one in a channel the bot has lost Manage Messages in, or a
		// burst that reached back past Discord's two-week bulk-delete limit. None is worth failing the whole
		// pipeline for -- the filter log still gets posted, and now it says the messages could not be removed
		// instead of claiming they were.
		logger.warn({ err: error, messageId: message.id, targets: targets.length }, 'could not delete filtered messages');
		return 'failed';
	}
}

/**
 * Feature 12 ("DM on trigger"), which is all that is left of it after P5a. A banword policy files a case and
 * `applyModerationAction` DMs about that; this path punishes nobody by itself, so without this the member's
 * message simply vanishes with no explanation at all -- which is the complaint the feature was written for.
 *
 * A ladder rung that punishes sends its own DM through `applyModerationAction`, so a member on a rung gets both:
 * one saying their message was removed, one saying what the punishment was. That is the honest pair -- they are
 * two different pieces of news.
 */
async function notifyAuthor(message: LoggableMessage, verdicts: FilterVerdict[], logger: Logger): Promise<void> {
	const api = getContext().service.client.api;

	try {
		const guild = await api.guilds.get(message.guild_id);
		const reasons = verdicts.map((verdict) => FILTER_LABEL[verdict.kind].dm);
		const content = `Your message in **${guild.name}** was removed because ${reasons.join(' and ')}.`;

		await executeAction(
			{
				action: 'dm',
				guildId: message.guild_id,
				source: 'automod',
				targetId: message.author.id,
				async execute() {
					const channel = await api.users.createDM(message.author.id);
					await api.channels.createMessage(channel.id, { content });
				},
			},
			logger,
		);
	} catch (error) {
		// Closed DMs are the ordinary case, not a failure -- `moderation.ts` swallows the same error for the
		// same reason.
		logger.info({ err: error, targetId: message.author.id }, 'could not DM a member about a filtered message');
	}
}

async function postFilterLog(
	webhook: AutomoderatorLogWebhooks,
	message: LoggableMessage,
	verdicts: FilterVerdict[],
	outcome: FilterOutcome,
	logger: Logger,
): Promise<void> {
	// One embed per runner rather than one per message: the fields are per-filter (which filter, what it
	// matched) and merging two runners into one embed means inventing a way to say which match came from which.
	// Comfortably inside Discord's ten-embed limit, since only three runners can ever fire here.
	//
	// The outcome is shared across them on purpose -- the deletion and the ladder rung happened once, to the
	// member, not once per filter that caught them.
	const embeds = verdicts.map((verdict) =>
		buildFilterHitEmbed({
			author: {
				id: message.author.id,
				tag: formatCaseUserTag(message.author),
				avatar: message.author.avatar,
			},
			channelId: message.channel_id,
			source: FILTER_LABEL[verdict.kind].log,
			matched: verdict.matched.join(', '),
			content: message.content,
			outcome,
		}),
	);

	await dispatchLog(webhook, { source: 'automod', embeds }, logger);
}
