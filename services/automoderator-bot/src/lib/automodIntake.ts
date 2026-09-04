import type { Logger } from '@chatsift/backend-core';
import { fileReport, getContext, getReportsChannelId, ReportFailure } from '@chatsift/backend-core';
import { fetchUser, getSelfId } from '@chatsift/bot-core';
import { formatCaseNumber, formatCaseUserTag } from '@chatsift/core';
import type { AutomoderatorBanwordPolicies, AutomoderatorCaseAction, AutomoderatorLogWebhooks } from '@chatsift/db';
import type { Client, GatewayAutoModerationActionExecutionDispatchData } from '@discordjs/core';
import { GatewayDispatchEvents } from '@discordjs/core';
import { claimAutomodExecution } from './automodDedupe.js';
import { resolveAutomodRuleName } from './automodRules.js';
import { resolveBanwordPolicy } from './banwordPolicy.js';
import { findBypassRole } from './bypassRoles.js';
import type { CaseActor } from './cases.js';
import { traceDecision } from './decisionTrace.js';
import { findFilterImmunity, IMMUNITY_SUMMARY } from './filterImmunity.js';
import { dispatchLog, getLogWebhook, LOG_TYPE } from './guildLog.js';
import type { FilterOutcome } from './guildLogFormat.js';
import { buildFilterHitEmbed } from './guildLogFormat.js';
import { automodEvents, featureInvocations, filterHits, reportsTotal } from './metrics.js';
import { applyModerationAction } from './moderation.js';
import { syncReportCard } from './reportCard.js';

/**
 * The AutoMod hybrid's response layer (P5, feature 01): Discord matches, we react.
 *
 * At P0 this only observed, because the whole design rested on an unverified assumption -- that
 * `AUTO_MODERATION_ACTION_EXECUTION` carries a usable `matched_keyword`. The spike proved it; this is what the
 * observation became.
 *
 * **Nothing arrives at all** if the guild has no native rules, or if the `AutoModerationExecution` intent isn't
 * granted. Both are silent, so `automoderator_automod_events_total` sitting flat at zero for a guild that has
 * policies configured remains the port's most likely undetected failure.
 *
 * This bot never *writes* an AutoMod rule -- see `services/api`'s `listAutomodRules.ts` for that decision and
 * what it costs.
 */
const FEATURE = 'banwords';

/**
 * Mirrors `CREATE TYPE automoderator_banword_action`. A hand-written string union rather than the generated
 * enum, the same arrangement -- and for the same reason -- as `@chatsift/core`'s `CaseActionName`: kanel emits
 * the enum as a real TypeScript enum and `@chatsift/db` re-exports only its *type*, so there is no runtime
 * value to reference and a bare `'WARN'` is not assignable to it.
 *
 * **What that costs, said plainly, because an earlier version of this comment claimed otherwise.** Reaching the
 * union from a row needs a cast, and a cast is a hole no type can close: if `automoderator_banword_action`
 * gains a sixth value and nobody updates this union, the cast happily produces it and `Record<PunishmentAction,
 * …>` never notices. The maps below are total over *this union*, which catches a typo or an omission made
 * here -- it does not catch a migration made elsewhere. {@link classifyPolicyAction} is what catches that, at
 * runtime, and it is why the unknown branch exists rather than being dead code.
 */
type BanwordActionName = 'BAN' | 'KICK' | 'MUTE' | 'REPORT' | 'WARN';

/**
 * The subset that punishes somebody. REPORT is the one that does not -- it files a report card instead, which
 * is feature 30.
 */
type PunishmentAction = Exclude<BanwordActionName, 'REPORT'>;

type ClassifiedAction =
	| { readonly action: PunishmentAction; readonly kind: 'punishment' }
	| { readonly kind: 'report' }
	| { readonly kind: 'unknown' };

const POLICY_CASE_ACTION = {
	WARN: 'WARN',
	MUTE: 'MUTE',
	KICK: 'KICK',
	BAN: 'BAN',
} as unknown as Record<PunishmentAction, AutomoderatorCaseAction>;

/**
 * Splits a stored action into the three things this module can do with it.
 *
 * The `in` check is a **runtime** guard against a value the union above does not know about, which is exactly
 * the case the type system cannot reach across the cast. Without it, an unrecognised action indexes the map to
 * `undefined` and hands that to `applyModerationAction` as the case action -- Discord then rejects a request
 * built around it, or worse, the case row records an action nobody configured.
 *
 * Exported for its tests: a branch the compiler believes is unreachable is precisely the one somebody deletes
 * as dead code.
 */
export function classifyPolicyAction(action: BanwordActionName): ClassifiedAction {
	if (action === 'REPORT') {
		return { kind: 'report' };
	}

	return action in POLICY_CASE_ACTION ? { kind: 'punishment', action } : { kind: 'unknown' };
}

const SUMMARY_PAST: Record<PunishmentAction, string> = {
	WARN: 'Warned',
	MUTE: 'Muted',
	KICK: 'Kicked',
	BAN: 'Banned',
};

/**
 * A {@link FilterOutcome} plus the one thing the log does not render: whether anything actually happened.
 *
 * An extension rather than a field on `FilterOutcome` itself, because it is a *metrics* concern and the embed
 * builder has no business carrying it -- the filter log says the same sentence whether a report was filed or
 * refused, and only `featureInvocations` needs to tell those apart.
 */
interface PolicyOutcome extends FilterOutcome {
	readonly enforced: boolean;
}

/**
 * The member behind the event, which the payload does not carry.
 *
 * A failure is not fatal: a BAN still lands on somebody who has already left, and a case with an unknown tag is
 * a worse record than a named one but a far better one than none. Roles come back empty in that case, which
 * fails the bypass check **open** -- the direction that keeps an unreadable member from silently disabling the
 * filter for everybody.
 */
interface ResolvedTarget {
	readonly actor: CaseActor;
	readonly avatar: string | null;
	readonly roles: readonly string[];
}

async function resolveTarget(guildId: string, userId: string, logger: Logger): Promise<ResolvedTarget> {
	const api = getContext().service.client.api;

	try {
		const member = await api.guilds.getMember(guildId, userId);
		return {
			actor: { id: userId, tag: member.user ? formatCaseUserTag(member.user) : 'Unknown User' },
			avatar: member.user?.avatar ?? null,
			roles: member.roles,
		};
	} catch (error) {
		logger.info({ err: error, guildId, userId }, 'could not read the member behind an AutoMod hit');

		const user = await fetchUser(api, userId).catch(() => null);
		return {
			actor: { id: userId, tag: user ? formatCaseUserTag(user) : 'Unknown User' },
			avatar: user?.avatar ?? null,
			roles: [],
		};
	}
}

export function registerAutomodIntake(client: Client): void {
	client.on(GatewayDispatchEvents.AutoModerationActionExecution, async ({ data }) => {
		const logger = getContext().logger.child({
			event: 'autoModerationActionExecution',
			guildId: data.guild_id,
			ruleId: data.rule_id,
		});

		try {
			await handleExecution(data, logger);
		} catch (error) {
			featureInvocations.inc({ feature: FEATURE, outcome: 'failed' });
			logger.error({ err: error, ruleId: data.rule_id }, 'failed to respond to an AutoMod hit');
		}
	});
}

async function handleExecution(
	data: GatewayAutoModerationActionExecutionDispatchData,
	logger: Logger,
): Promise<void> {
	const matchedKeyword = data.matched_keyword ?? null;

	// Counts every event, before the deduplication below -- this is the raw-intake counter, and its whole job
	// is to be flat-zero when the intent or the guild's rules are missing.
	automodEvents.inc({ action_type: String(data.action.type), matched: String(matchedKeyword !== null) });

	// One trigger, not one event: a rule that blocks *and* times out dispatches two of these. Everything past
	// this line -- the hit counter, the filter log, the report, the punishment -- must happen once per message.
	if (!(await claimAutomodExecution(data))) {
		return;
	}

	filterHits.inc({ filter: 'words' });

	// Both cheap database reads, and between them they decide whether anything else here costs anything: a
	// guild with neither a policy for this rule nor a filter log has nothing to do, and that is the state
	// almost every guild the bot is in will be in for almost every rule.
	const [policy, webhook] = await Promise.all([
		resolveBanwordPolicy(data.guild_id, data.rule_id, matchedKeyword),
		getLogWebhook(data.guild_id, LOG_TYPE.FILTER),
	]);

	const traceBase = {
		runner: FEATURE,
		guildId: data.guild_id,
		targetId: data.user_id,
		...(matchedKeyword === null ? {} : { matched: matchedKeyword }),
	};

	if (!policy && !webhook) {
		traceDecision(logger, { ...traceBase, action: null });
		featureInvocations.inc({ feature: FEATURE, outcome: 'skipped' });
		return;
	}

	// Only ever resolved once, and only once something is going to use it -- the member lookup is the one REST
	// call this path makes for a hit nobody has configured a response to.
	const target = await resolveTarget(data.guild_id, data.user_id, logger);
	const ruleName = (await resolveAutomodRuleName(data.guild_id, data.rule_id)) ?? data.rule_id;

	const outcome = await decideOutcome({ data, policy, ruleName, matchedKeyword, target, traceBase }, logger);

	if (webhook) {
		await postFilterLog(webhook, { data, ruleName, matchedKeyword, target, outcome }, logger);
	}
}

interface OutcomeInput {
	readonly data: GatewayAutoModerationActionExecutionDispatchData;
	readonly matchedKeyword: string | null;
	readonly policy: Awaited<ReturnType<typeof resolveBanwordPolicy>>;
	readonly ruleName: string;
	readonly target: ResolvedTarget;
	readonly traceBase: { guildId: string; matched?: string; runner: string; targetId: string };
}

async function decideOutcome(input: OutcomeInput, logger: Logger): Promise<PolicyOutcome> {
	const { data, policy, ruleName, matchedKeyword, target, traceBase } = input;

	// A guild with no policy for this rule gets the log line and nothing else. Still counted as a hit above:
	// "this rule is catching things you have no policy for" is a real answer to a real question.
	if (!policy) {
		traceDecision(logger, { ...traceBase, action: null });
		featureInvocations.inc({ feature: FEATURE, outcome: 'skipped' });
		return { summary: 'No policy configured', enforced: false };
	}

	// The same gate the runner filters apply, and it belongs here too: Discord has already blocked the message
	// by the time we see this, so what is skipped is the *punishment* -- which for an owner is one Discord would
	// refuse anyway. Above the bypass read because it answers the same question without a configured row.
	const immunity = await findFilterImmunity(data.guild_id, data.user_id, target.roles);
	if (immunity) {
		traceDecision(logger, { ...traceBase, action: null, immunity });
		featureInvocations.inc({ feature: FEATURE, outcome: 'skipped' });
		return { summary: IMMUNITY_SUMMARY[immunity], enforced: false };
	}

	const bypassRoleId = await findBypassRole(data.guild_id, target.roles);
	if (bypassRoleId) {
		traceDecision(logger, { ...traceBase, action: null, bypassRoleId });
		featureInvocations.inc({ feature: FEATURE, outcome: 'skipped' });
		return { summary: `Skipped: <@&${bypassRoleId}> bypasses filters`, enforced: false };
	}

	const classified = classifyPolicyAction(policy.policy.actionType as unknown as BanwordActionName);

	if (classified.kind === 'unknown') {
		// A policy row this build does not understand -- a migration that added an action ahead of the code that
		// handles it. Counted as `failed` rather than `skipped`, because nothing about this is a decision: the
		// guild configured something and it did not happen.
		logger.error(
			{ guildId: data.guild_id, ruleId: data.rule_id, actionType: policy.policy.actionType },
			'banword policy names an action this build does not know how to carry out',
		);
		featureInvocations.inc({ feature: FEATURE, outcome: 'failed' });
		return { summary: 'Nothing done: this policy names an unrecognised action', enforced: false };
	}

	const outcome =
		classified.kind === 'punishment'
			? await runPunishmentPolicy(data, policy.policy, classified.action, ruleName, target.actor, matchedKeyword, logger)
			: await runReportPolicy(data, target.actor, ruleName, matchedKeyword, logger);

	// A report the guild had nowhere to file is not an enforcement. Counting it as `applied` would show a
	// healthy rate for a guild whose REPORT policies do nothing at all, which is the exact failure these
	// counters exist to surface.
	featureInvocations.inc({ feature: FEATURE, outcome: outcome.enforced ? 'applied' : 'skipped' });
	return outcome;
}

/**
 * The reason that goes on the case and, through it, into the audit log and the target's DM.
 *
 * Names the *rule* when the policy is rule-level and the *word* when it is keyword-level, which is the
 * difference the target can act on -- "a word from our slurs list" versus "this specific word".
 */
function policyReason(policy: AutomoderatorBanwordPolicies, ruleName: string, matchedKeyword: string | null): string {
	return policy.keyword === null || matchedKeyword === null
		? `Automatic punishment for a message caught by ${ruleName}`
		: `Automatic punishment for using the word/phrase "${matchedKeyword}"`;
}

async function runPunishmentPolicy(
	data: GatewayAutoModerationActionExecutionDispatchData,
	policy: AutomoderatorBanwordPolicies,
	action: PunishmentAction,
	ruleName: string,
	target: CaseActor,
	matchedKeyword: string | null,
	logger: Logger,
): Promise<PolicyOutcome> {
	const durationMs = policy.durationSeconds === null ? undefined : policy.durationSeconds * 1_000;

	const result = await applyModerationAction(
		{
			action: POLICY_CASE_ACTION[action],
			guildId: data.guild_id,
			target,
			// No human authored this. A case attributed to whoever wrote the rule would claim they were online
			// and acting, and the mod log would repeat that claim forever.
			mod: null,
			reason: policyReason(policy, ruleName, matchedKeyword),
			source: 'automod',
			...(durationMs === undefined ? {} : { durationMs }),
			// Discord can redeliver a dispatch after a resume, and this path both punishes *and* files. Keyed on
			// the rule as well as the message, so a message caught by two rules still produces both punishments.
			// A *blocked* message has no id to key on -- Discord suppressed it before it existed -- so that case
			// is knowingly unprotected; the alternative keys are all ones that would suppress a genuine repeat
			// offence.
			...(data.message_id ? { idempotencyKey: `automod:${data.rule_id}:${data.message_id}` } : {}),
		},
		logger,
	);

	return {
		summary: SUMMARY_PAST[action],
		caseRef: formatCaseNumber(result.case.caseId, {
			guildId: data.guild_id,
			logChannelId: result.logChannelId,
			logMessageId: result.case.logMessageId,
		}),
		enforced: true,
	};
}

/**
 * Feature 30, "report instead of delete", as the port reshapes it: the *suppression* decision moved into
 * Discord's rule config (block versus alert), and this is the half that is still ours.
 *
 * Files an **account-level** report when Discord blocked the message, because there is then no message for the
 * card to link to. The report still names the member and the reason, which is the part staff act on -- a guild
 * that wants the card to carry the offending text sets the rule to alert rather than block, which is what the
 * policy editor says on the field.
 */
async function runReportPolicy(
	data: GatewayAutoModerationActionExecutionDispatchData,
	target: CaseActor,
	ruleName: string,
	matchedKeyword: string | null,
	logger: Logger,
): Promise<PolicyOutcome> {
	// Checked before anything is written, so nothing accumulates in a queue the guild has nowhere to read --
	// the same guard `reportFlow.ts` puts in front of every member-filed report.
	if (!(await getReportsChannelId(data.guild_id))) {
		return { summary: 'Report skipped: no reports channel configured', enforced: false };
	}

	const api = getContext().service.client.api;
	// The id is resolved on its own and never falls back to anything: `fetchUser` is only ever an *enrichment*
	// here, supplying a display tag. Folding the two together once let a failed lookup file a report whose
	// reporter was the person being reported.
	const selfId = await getSelfId(api);
	// Not named `self`: eslint's `consistent-this` reserves that identifier for `this` aliases.
	const botUser = await fetchUser(api, selfId).catch(() => null);

	const reason =
		matchedKeyword === null
			? `Automatic report: message caught by ${ruleName}`
			: `Automatic report: used the word/phrase "${matchedKeyword}"`;

	try {
		const result = await fileReport({
			guildId: data.guild_id,
			target,
			reporter: { id: selfId, tag: botUser ? formatCaseUserTag(botUser) : 'AutoModerator' },
			reason,
			message:
				data.message_id && data.channel_id
					? {
							messageId: data.message_id,
							channelId: data.channel_id,
							content: data.matched_content ?? data.content ?? null,
							imageUrl: null,
						}
					: null,
		});

		reportsTotal.inc({ state: result.joined ? 'joined' : 'filed' });
		await syncReportCard(result.report, { reporterCount: result.reporterCount }, logger);

		return { summary: result.joined ? 'Added to an open report' : 'Reported to staff', enforced: true };
	} catch (error) {
		// A refusal is an ordinary outcome rather than a failure -- "this member already has an open report" is
		// the common one, and it belongs in the filter log rather than in an error path.
		if (error instanceof ReportFailure) {
			return { summary: `Report skipped: ${error.message}`, enforced: false };
		}

		throw error;
	}
}

async function postFilterLog(
	webhook: AutomoderatorLogWebhooks,
	details: {
		data: GatewayAutoModerationActionExecutionDispatchData;
		matchedKeyword: string | null;
		outcome: FilterOutcome;
		ruleName: string;
		target: ResolvedTarget;
	},
	logger: Logger,
): Promise<void> {
	const { data, target } = details;

	await dispatchLog(
		webhook,
		{
			source: 'automod',
			embeds: [
				buildFilterHitEmbed({
					author: { id: data.user_id, tag: target.actor.tag, avatar: target.avatar },
					channelId: data.channel_id ?? null,
					source: details.ruleName,
					matched: details.matchedKeyword,
					// `matched_content` is the substring that tripped the rule, which is what a moderator wants;
					// `content` is the whole message and is empty without the MessageContent intent.
					content: data.matched_content ?? data.content ?? null,
					outcome: details.outcome,
				}),
			],
		},
		logger,
	);
}
