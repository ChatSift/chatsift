import type { AppealActor } from '@chatsift/backend-core';
import { APPEAL_STATUS, applyAppealDecision, getContext } from '@chatsift/backend-core';
import { formatCaseUserTag } from '@chatsift/core';
import type { AppealStatus, Appeals } from '@chatsift/db';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { badGateway, conflict, notFound } from '@hapi/boom';
import { z } from 'zod';
import { appealDecisions } from '../../../core/metrics.js';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { syncAppealCard } from '../../../util/appealCard.js';
import { apiForGuild, discordAPIAppeals } from '../../../util/discordAPI.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { resolveDiscordUser } from '../../../util/users.js';
import { decideAppealBodySchema } from '../schemas.js';
import type { AppealWithUsers } from './util.js';
import { resolveAppealUsers } from './util.js';

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
		// else. The tag is resolved rather than stored: `appeals` has no moderator snapshot column, and this one
		// is only ever read back into the audit-log reason on the unban below.
		const actorId = req.tokens!.access.sub;
		const resolved = await resolveDiscordUser(discordAPIAppeals, actorId);
		const moderator: AppealActor = {
			id: actorId,
			tag: typeof resolved === 'string' ? actorId : formatCaseUserTag(resolved),
		};

		const result = await applyAppealDecision({
			appealId: existing.id,
			status: STATUS_FOR[decision],
			silent: decision === 'deny_silent',
			moderator,
			reason: reason ?? null,
			// Only an approval touches Discord, exactly as on the card. A denial writes a row and redraws a card,
			// and P6 is what turns the non-silent kind into a DM -- a DM that could not be delivered must not
			// un-deny an appeal, so it will not be reaching for `perform` either.
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

		// After the decision is committed, and never allowed to fail it: a stale card next to a correct database
		// is the honest degradation, and `syncAppealCard` does not throw.
		await syncAppealCard(result.appeal);

		const [appeal] = await resolveAppealUsers([result.appeal]);
		return appeal!;
	},
});

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
