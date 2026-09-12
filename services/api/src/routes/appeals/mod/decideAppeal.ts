import type { AppealActor, AppealDeliveryResult } from '@chatsift/backend-core';
import { APPEAL_STATUS, applyAppealDecision, deliverAppealDecision, getContext } from '@chatsift/backend-core';
import { formatCaseUserTag } from '@chatsift/core';
import type { AppealStatus, Appeals } from '@chatsift/db';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { badGateway, conflict, notFound } from '@hapi/boom';
import { z } from 'zod';
import { appealDecisions, appealDeliveries } from '../../../core/metrics.js';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { syncAppealCard } from '../../../util/appealCard.js';
import { apiAppealDelivery } from '../../../util/appealDelivery.js';
import { apiForGuild, discordAPIAppeals } from '../../../util/discordAPI.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { resolveDiscordUser } from '../../../util/users.js';
import { decideAppealBodySchema } from '../schemas.js';
import type { AppealWithUsers } from './util.js';
import { attachAppealUsers, resolveAppealUsers } from './util.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	appealId: z.coerce.number().int().positive(),
});

export type DecideAppealBody = z.infer<typeof decideAppealBodySchema>;
export type DecideAppealResult = AppealWithUsers;

type Decision = DecideAppealBody['decision'];

const STATUS_FOR: Record<Decision, AppealStatus> = {
	approve: APPEAL_STATUS.APPROVED,
	deny: APPEAL_STATUS.DENIED,
	deny_silent: APPEAL_STATUS.DENIED,
};

/**
 * The metric label each decision carries, matching `services/appeals-bot`'s `AppealDecisionName` exactly -- the
 * two halves of `appeals_decisions_total` are summed by Grafana and a divergence here does not error, it
 * silently splits the series (see `core/metrics.ts`).
 */
const METRIC_DECISION: Record<Decision, string> = {
	approve: 'approved',
	deny: 'denied',
	deny_silent: 'denied_silent',
};

/**
 * The dashboard's half of decision 1: both mod surfaces exist from the start, and they converge on **one**
 * transition rather than two that drift. That transition is `applyAppealDecision` in `@chatsift/backend-core`;
 * everything here is the API's half around it -- the unban an approval performs, the card redraw, the counter.
 *
 * Gated on Manage Guild like every other dashboard route, not on the Ban Members the card's buttons check.
 * The asymmetry is deliberate and buys nothing to close: Manage Guild is what lets somebody configure Appeals
 * (and grant themselves Ban Members) in the first place, so a stricter gate here would be a speed bump rather
 * than a boundary. What the two surfaces must agree on is the *decision*, and they do.
 */
export default defineRoute({
	method: 'post',
	path: '/v3/guilds/:guildId/appeals/queue/:appealId/decision',
	schema: { body: decideAppealBodySchema, params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	// Deliberately no `realtimeChannel`: `applyAppealDecision` publishes to `appealsQueueChannel` itself, because
	// the bot's buttons need that broadcast too and neither surface should have to remember it. Declaring one
	// here would send a second invalidate for every dashboard decision.
	async handler(req): Promise<DecideAppealResult> {
		const { guildId, appealId } = req.params;
		const { decision, reason } = req.body;
		const context = getContext();

		const [existing] = await context.db<Appeals[]>`
			SELECT * FROM appeals WHERE guild_id = ${guildId} AND id = ${appealId}
		`;

		if (!existing) {
			throw notFound('appeal not found');
		}

		// Taken from the session, never the body -- a client must not be able to attribute a decision to someone
		// else. The tag is resolved rather than stored: `appeals` has no moderator snapshot column, and it is only
		// ever read back into the audit-log reason on the unban below.
		const moderator = await resolveModerator(req.tokens!.access.sub);

		const result = await applyAppealDecision({
			appealId: existing.id,
			status: STATUS_FOR[decision],
			silent: decision === 'deny_silent',
			moderator,
			reason: reason ?? null,
			// Only an approval touches Discord *from inside the claim*, exactly as on the card. P6's DM and re-add
			// happen after it commits and deliberately never reach `perform`: a DM Discord refused must not
			// un-deny an appeal, and an unban that already landed cannot be taken back by a failed delivery.
			...(decision === 'approve'
				? {
						async perform(claimed: Appeals) {
							await unban(claimed, moderator);
						},
					}
				: {}),
		});

		if (!result.ok) {
			appealDecisions.inc({ decision: METRIC_DECISION[decision], outcome: result.reason, source: 'dashboard' });

			if (result.reason === 'raced') {
				throw conflict('somebody else decided this appeal first');
			}

			context.logger.error(
				{ err: result.error, guildId, appealId: existing.id, decision },
				'failed to carry out an appeal decision',
			);

			// The claim has already been given back, so the appeal is open and this is safe to retry -- which is
			// what the message tells them to do once the permission is back.
			throw badGateway(
				'could not lift that ban, so the appeal has been left open -- check Appeals still has Ban Members',
			);
		}

		appealDecisions.inc({ decision: METRIC_DECISION[decision], outcome: 'applied', source: 'dashboard' });

		// Delivered *before* the card is redrawn, not after: the card renders `appeal_user_state.dm_reachable`,
		// and the delivery is what writes it. The other order leaves a card claiming a decision reached somebody
		// it bounced off, until the next thing happens to redraw it -- which for a decided appeal is never.
		// Like everything else past the claim, it cannot fail the request (see `deliverAppealDecision`).
		const delivery = await deliverAppealDecision({
			appeal: result.appeal,
			discord: apiAppealDelivery(),
			logger: context.logger,
		});

		countDelivery(delivery);

		// After the decision is committed, and never allowed to fail it: a stale card next to a correct database
		// is the honest degradation, and `syncAppealCard` does not throw.
		await syncAppealCard(result.appeal);

		return describeDecided(result.appeal);
	},
});

/**
 * Split from the decision counter deliberately, and labelled per attempt: a denial that was decided and a
 * denial that reached the person it was about are two different successes, and `appeals_decisions_total` only
 * ever knew about the first.
 */
function countDelivery(delivery: AppealDeliveryResult): void {
	appealDeliveries.inc({ kind: 'dm', outcome: delivery.dm, source: 'dashboard' });
	appealDeliveries.inc({ kind: 'rejoin', outcome: delivery.rejoin, source: 'dashboard' });
}

/**
 * Who to credit the unban to in Discord's audit log.
 *
 * Best-effort by construction, like `resolveAppellant` on the card: `resolveDiscordUser` only swallows a 404,
 * so a rate limit or a 5xx while looking up the moderator's *own* account would otherwise fail a decision that
 * has nothing else wrong with it. The tag feeds one audit-log reason string and nothing else -- the decision is
 * attributed by `decided_by_id`, straight off the session -- so falling back to the id is a worse audit line,
 * not a wrong one.
 *
 * Worth guarding rather than trusting the cache to be warm: `/users/@me` is deliberately not routed through
 * `fetchUserCached` (see `util/users.ts`), so a moderator's first decision is a genuine miss.
 */
async function resolveModerator(actorId: string): Promise<AppealActor> {
	try {
		const resolved = await resolveDiscordUser(discordAPIAppeals, actorId);
		return { id: actorId, tag: typeof resolved === 'string' ? actorId : formatCaseUserTag(resolved) };
	} catch (error) {
		getContext().logger.warn({ err: error, actorId }, 'could not resolve the moderator deciding an appeal');
		return { id: actorId, tag: actorId };
	}
}

/**
 * The decided row for the response, with its accounts resolved if Discord is willing.
 *
 * Soft for the same reason everything else past the claim is: by the time this runs the decision is committed
 * and the unban has happened, so a user lookup that fails must degrade to bare ids rather than answer a landed
 * decision with a 500 -- which the client would then retry into a `raced` 409 blaming somebody else. The
 * dashboard invalidates and refetches the queue on success anyway, so this body is a courtesy.
 */
async function describeDecided(appeal: Appeals): Promise<AppealWithUsers> {
	try {
		const [resolved] = await resolveAppealUsers([appeal]);
		return resolved!;
	} catch (error) {
		getContext().logger.warn({ err: error, appealId: appeal.id }, 'could not resolve the accounts on a decided appeal');
		return attachAppealUsers([appeal], new Map())[0]!;
	}
}

/**
 * Lifts the ban an approval was about, the same way the card's Approve button does.
 *
 * `Unknown Ban` is success, not failure: somebody unbanning them by hand while the appeal sat open is a
 * perfectly ordinary way for a guild to work, and the end state this call exists to reach is already true.
 * Anything else throws, which hands the claim back and leaves the appeal open -- see `applyAppealDecision`
 * for why that ordering is not negotiable.
 */
async function unban(appeal: Appeals, moderator: AppealActor): Promise<void> {
	const api = apiForGuild('APPEALS', appeal.guildId);

	try {
		await api.guilds.unbanUser(appeal.guildId, appeal.userId, {
			reason: `Appeal ${appeal.id} approved by ${moderator.tag}`,
		});
	} catch (error) {
		if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownBan) {
			return;
		}

		throw error;
	}
}
