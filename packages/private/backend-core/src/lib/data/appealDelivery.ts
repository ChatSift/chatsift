import { URLSearchParams } from 'node:url';
import type { AppealRejoinOutcome } from '@chatsift/core';
import { appealsQueueChannel, buildAppealDecisionMessage } from '@chatsift/core';
import type { Appeals } from '@chatsift/db';
import { getContext } from '../context.js';
import type { Logger } from '../logger.js';
import { publishRealtimeInvalidate } from '../realtimeBroadcast.js';
import {
	dropSpentRejoinCredential,
	readAppealUserState,
	readRejoinCredential,
	recordAppellantRefreshToken,
	recordDmReachability,
} from './appealUserState.js';
import { APPEAL_EVENT, APPEAL_STATUS, getAppealsSettings, recordAppealEvent } from './appeals.js';

/**
 * Getting a decision to the person it is about (#232 P6, §6 and decision 14).
 *
 * Shared by both mod surfaces for the reason decision 1 gives: the card's buttons decide from
 * `services/appeals-bot` and the dashboard decides from `services/api`, and a denial that reaches the appellant
 * differently depending on which button a moderator happened to be near is the drift that decision exists to
 * prevent. What lives here is the part worth having once -- the branch on `silent`, decision 14's three-sided
 * consent, the token rotation, what gets written down afterwards, and the order all of it happens in.
 *
 * The Discord calls themselves are injected, exactly as `applyAppealDecision` injects its unban: this package
 * has no `@discordjs/rest` dependency and is not getting one -- see `AppealDeliveryDiscord` below.
 *
 * **Nothing in here may throw.** By the time it runs the decision is committed and an approval's unban has
 * already happened, so a failure to deliver is a decision the appellant was not told about -- which is worth
 * recording and worth warning a moderator about, and is never worth reporting as a decision that did not land.
 */

export interface AppealDeliveryDiscord {
	/**
	 * `PUT /guilds/:guild/members/:user` with the appellant's freshly minted access token. Needs
	 * `CREATE_INSTANT_INVITE` on Appeals in that guild, which is not a permission the config screen demands --
	 * so a rejection here is ordinary, not exceptional.
	 */
	addMember(guildId: string, userId: string, accessToken: string): Promise<void>;
	/**
	 * A single-use, short-lived invite to somewhere in the guild, or `null` when Appeals cannot make one.
	 */
	createInvite(guildId: string): Promise<string | null>;
	/**
	 * What the guild is called, or `null` if Discord will not say.
	 */
	guildName(guildId: string): Promise<string | null>;
	/**
	 * Opens the DM and sends it. Resolves `'blocked'` when Discord refuses the message (closed DMs, a block, no
	 * user install), which is an outcome rather than an error; anything else throws and is reported as
	 * `'failed'`.
	 */
	sendDirectMessage(userId: string, content: string): Promise<'blocked' | 'sent'>;
}

/**
 * - `sent` / `blocked` -- a real attempt, and the two things `appeal_user_state.dm_reachable` is written from.
 * - `failed` -- something went wrong on our side or Discord's. Deliberately **not** written to
 *   `dm_reachable`: a timeout says nothing about whether this person can be reached.
 * - `skipped` -- nothing was owed. A silent denial (decision 6), or a transition nobody is told about.
 */
export type AppealDeliveryDm = 'blocked' | 'failed' | 'sent' | 'skipped';

export interface AppealDeliveryResult {
	readonly dm: AppealDeliveryDm;
	/**
	 * `'none'` whenever no approval was involved, as well as when an approval had no invite to offer.
	 */
	readonly rejoin: AppealRejoinOutcome;
}

export interface DeliverAppealDecisionOptions {
	readonly appeal: Appeals;
	readonly discord: AppealDeliveryDiscord;
	readonly logger: Logger;
}

const SKIPPED: AppealDeliveryResult = { dm: 'skipped', rejoin: 'none' };

/**
 * One sentence saying what became of the decision, written as a verb phrase so it reads under the `Appeals`
 * actor on the dashboard's trail ("Appeals DMed them the decision") and tacks onto the end of the moderator's
 * ephemeral line in Discord.
 *
 * Never says "notified" or "delivered" on its own: the only two outcomes a moderator has to act differently on
 * are "they were not told" and "they might not have been", and both have to survive being skim-read.
 */
export function describeAppealDelivery(result: AppealDeliveryResult): string {
	const rejoined = result.rejoin === 'added' ? ' and put them back in the server' : '';

	switch (result.dm) {
		case 'sent':
			return result.rejoin === 'invited'
				? 'DMed them the decision, with an invite back.'
				: `DMed them the decision${rejoined}.`;
		case 'blocked':
			return `Could not DM them -- Discord will not deliver messages to this account${rejoined ? ', though they were put back in the server' : ''}. They have not been told.`;
		case 'failed':
			return `Something went wrong sending their DM${rejoined}, so they may not have been told.`;
		case 'skipped':
			return 'Nothing was sent.';
	}
}

/**
 * Delivers a decision, and re-adds the appellant when all three sides of decision 14 agree.
 *
 * Called after the transition has committed and before the card is redrawn, so the card renders what actually
 * reached the appellant rather than what was about to be attempted.
 */
export async function deliverAppealDecision(options: DeliverAppealDecisionOptions): Promise<AppealDeliveryResult> {
	const { appeal, discord, logger } = options;

	// A silent denial sends nothing, and that is the whole feature rather than an optimisation (decision 6):
	// their page reads "under review" and always will. Every other non-decision status -- a withdrawal they
	// performed themselves, a `MOOT` close of a ban somebody else lifted -- has nothing to announce either.
	if (appeal.silent || (appeal.status !== APPEAL_STATUS.APPROVED && appeal.status !== APPEAL_STATUS.DENIED)) {
		return SKIPPED;
	}

	try {
		const approved = appeal.status === APPEAL_STATUS.APPROVED;
		const attempted = approved ? await returnThem(appeal, discord, logger) : 'none';

		// The invite is resolved before the outcome is settled, not after, because failing to mint one changes
		// what happened rather than just what is attached: `'invited'` with nothing to click would promise a way
		// back in the DM copy and claim one in the moderator's, and `'none'` is the branch that tells the truth
		// on both sides. Only an approval ever gets here with `'invited'`.
		const inviteURL = attempted === 'invited' ? await invite(appeal, discord, logger) : null;
		const rejoin: AppealRejoinOutcome = attempted === 'invited' && !inviteURL ? 'none' : attempted;

		const guildName = await safely(async () => discord.guildName(appeal.guildId), null, logger, 'guild name');
		const content = buildAppealDecisionMessage(approved ? 'APPROVED' : 'DENIED', {
			guildName,
			inviteURL,
			reason: appeal.decisionReason,
			rejoin,
		});

		const result: AppealDeliveryResult = { dm: await sendDm(appeal.userId, content, discord, logger), rejoin };

		// Recorded per appeal, because `dm_reachable` is one row per person overwritten by every later attempt and
		// therefore cannot answer "was *this* decision delivered" a month from now -- which is the question a
		// moderator looking at an old appeal is actually asking.
		await safely(
			async () => recordAppealEvent(appeal.id, APPEAL_EVENT.DELIVERY, { body: describeAppealDelivery(result) }),
			undefined,
			logger,
			'delivery event',
		);

		await safely(async () => dropSpentRejoinCredential(appeal.userId), undefined, logger, 'credential cleanup');

		// A second broadcast, and not a redundant one: `applyAppealDecision` published the *decision*, which
		// commits before any of this runs. A moderator watching the same appeal refetched on that signal and got
		// a decided appeal with no `DELIVERY` row on its trail and no "they were not told" on its card -- the two
		// things a second moderator most needs to see, arriving only on their next manual reload. Published here
		// rather than in each surface for the reason `applyAppealDecision` publishes its own: neither should have
		// to remember, and the bot's buttons need it as much as the dashboard does.
		await safely(
			async () => publishRealtimeInvalidate(appealsQueueChannel(appeal.guildId)),
			undefined,
			logger,
			'delivery invalidate',
		);

		return result;
	} catch (error) {
		// Belt and braces over the per-step guards below: this function is awaited from inside two already-
		// committed decisions, and in the bot's case a rejection escaping here would be an unhandled listener
		// error, which `registerFatalErrorHandlers` treats as fatal.
		logger.error({ err: error, guildId: appeal.guildId, appealId: appeal.id }, 'failed to deliver an appeal decision');
		return { dm: 'failed', rejoin: 'none' };
	}
}

/**
 * Decision 14, evaluated: the guild turned it on, the appellant ticked the box on *this* appeal, and their
 * account-level `guilds.join` grant is still usable. All three, or they get an invite instead.
 *
 * The three are separate on purpose and none of them stands in for another. `auto_rejoin` is the guild saying
 * it wants approvals to restore membership rather than only lift the ban; `rejoin_consent` is this person
 * agreeing to be returned to *this* server; and the OAuth grant is the only one of the three that is a
 * capability rather than a preference. A guild cannot consent on somebody's behalf and a grant given once to
 * `unban.app` is not a standing instruction about every server they are banned from.
 */
async function returnThem(
	appeal: Appeals,
	discord: AppealDeliveryDiscord,
	logger: Logger,
): Promise<AppealRejoinOutcome> {
	if (!appeal.rejoinConsent) {
		return 'invited';
	}

	const settings = await safely(async () => getAppealsSettings(appeal.guildId), null, logger, 'appeals settings');
	if (!settings?.autoRejoin) {
		return 'invited';
	}

	const state = await safely(async () => readAppealUserState(appeal.userId), null, logger, 'appellant state');
	const credential = readRejoinCredential(state);
	if (!credential) {
		return 'invited';
	}

	try {
		const refreshed = await refreshAppellantAccessToken(credential);
		if (!refreshed) {
			return 'invited';
		}

		// Written before the add rather than after it: Discord invalidates the token that was just presented, so
		// an add that throws with the rotation unsaved leaves the account holding a credential that is already
		// dead -- and every later approval for them falling back to an invite with no explanation.
		await recordAppellantRefreshToken(appeal.userId, refreshed.refreshToken);
		await discord.addMember(appeal.guildId, appeal.userId, refreshed.accessToken);

		return 'added';
	} catch (error) {
		// Ordinary rather than exceptional: Appeals needs `CREATE_INSTANT_INVITE` in the guild to add anybody,
		// the appellant may have revoked the authorization since, and a server at its member cap refuses
		// outright. All of them land on the invite, which is the fallback this exists to reach.
		logger.info(
			{ err: error, guildId: appeal.guildId, appealId: appeal.id },
			'could not add an approved appellant back, falling back to an invite',
		);

		return 'invited';
	}
}

async function invite(appeal: Appeals, discord: AppealDeliveryDiscord, logger: Logger): Promise<string | null> {
	return safely(async () => discord.createInvite(appeal.guildId), null, logger, 'rejoin invite');
}

async function sendDm(
	userId: string,
	content: string,
	discord: AppealDeliveryDiscord,
	logger: Logger,
): Promise<AppealDeliveryDm> {
	let outcome: AppealDeliveryDm;

	try {
		outcome = await discord.sendDirectMessage(userId, content);
	} catch (error) {
		logger.warn({ err: error, userId }, 'failed to DM an appellant their decision');
		return 'failed';
	}

	// Only a real answer is written down. A `failed` send is a fact about a request, not about an account, and
	// recording it as unreachable would put a warning on every future appeal of theirs over one bad minute.
	await safely(async () => recordDmReachability(userId, outcome === 'sent'), undefined, logger, 'dm reachability');

	return outcome;
}

/**
 * Runs a step that must not be allowed to cost the appellant their delivery, and returns `fallback` when it
 * does. Every step here is either best-effort by nature or already past the point where failing is an option.
 */
async function safely<TValue>(
	run: () => Promise<TValue>,
	fallback: TValue,
	logger: Logger,
	what: string,
): Promise<TValue> {
	try {
		return await run();
	} catch (error) {
		logger.warn({ err: error, step: what }, 'a step of an appeal delivery failed');
		return fallback;
	}
}

/**
 * How long the OAuth refresh may take before the approval gives up and falls back to an invite.
 *
 * `fetch` has no deadline of its own, and this is the one Discord call in the delivery path that does not go
 * through `@discordjs/rest` (which brings its own). Everything downstream of it is already committed -- the
 * decision, and an approval's unban -- so a stall here does not risk correctness; what it holds up is the
 * `DELIVERY` event, the credential cleanup, the card redraw, and, on the dashboard, the moderator's HTTP
 * response. Ten seconds is generous for a token exchange and short enough that nobody watches a spinner over
 * it.
 */
const REFRESH_TIMEOUT_MS = 10_000;

export interface RefreshedAppellantToken {
	readonly accessToken: string;
	readonly refreshToken: string;
}

/**
 * Redeems a stored refresh token for an access token that can be spent on `guilds.join`.
 *
 * A hand-rolled form POST rather than `@discordjs/core`'s `oauth2.refreshToken`, because the two callers are in
 * different processes and neither should have to own the OAuth client: this is the one Discord call in the
 * whole delivery path that carries no bot token and no per-guild routing, so there is nothing for an injected
 * `API` to decide. It goes direct for the same reason `services/api`'s `discordAPIOAuth` does -- the REST proxy
 * partitions its rate-limit state by `Authorization` header, and these requests have none.
 *
 * `null` for anything Discord refuses, which is an expected outcome: the appellant revoking the authorization
 * from their Discord settings is exactly the shape of refusal this gets, and the approval falls back to an
 * invite.
 */
export async function refreshAppellantAccessToken(refreshToken: string): Promise<RefreshedAppellantToken | null> {
	const env = getContext().env;

	const response = await fetch('https://discord.com/api/v10/oauth2/token', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: env.APPEALS_OAUTH_CLIENT_ID,
			client_secret: env.APPEALS_OAUTH_CLIENT_SECRET,
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
		}),
		// An abort throws, which `returnThem`'s catch already treats as a refusal -- so a Discord that stalls
		// lands on the invite fallback rather than on a request nobody ever answers.
		signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
	});

	if (!response.ok) {
		getContext().logger.info({ status: response.status }, 'discord refused an appellant refresh token');
		return null;
	}

	const body = (await response.json()) as { access_token?: string; refresh_token?: string; scope?: string };
	if (!body.access_token || !body.refresh_token) {
		return null;
	}

	// Re-checked rather than assumed. An appellant can re-authorize at any time and trim the scope on the way
	// through, and the row's `granted_guilds_join` records what they agreed to *last* time -- spending an access
	// token that no longer carries the scope would just be a 403 dressed up as an attempt.
	if (!new Set(body.scope?.split(' ') ?? []).has('guilds.join')) {
		return null;
	}

	return { accessToken: body.access_token, refreshToken: body.refresh_token };
}
