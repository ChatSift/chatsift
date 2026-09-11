import type { Logger } from '@chatsift/backend-core';
import { APPEAL_STATUS, applyAppealDecision, getContext, getOpenAppeal } from '@chatsift/backend-core';
import type { AppealKind } from '@chatsift/db';
import type { Client } from '@discordjs/core';
import { GatewayDispatchEvents } from '@discordjs/core';
import { refreshAppealCard } from './appealComponents.js';
import { appealDecisions, banEvents } from './metrics.js';

/**
 * The cast every kanel enum needs -- `@chatsift/db` re-exports the type only. `services/api` has the same
 * constant in `appealsEligibility.ts`; a service cannot import from another service.
 */
const APPEAL_KIND_BAN = 'BAN' as AppealKind;

/**
 * Records a ban in `appeal_ban_checks` (#232).
 *
 * **This inserts, as of 2026-09-10.** It used to be `UPDATE`-only, on the reasoning that a table fed by the
 * gateway would become the partial ban mirror docs/roadmap/09-appeals.md §4 rejects. The owner reversed that,
 * and the reversal is right: what §4 actually rejects is treating such a table as *authoritative*, and nothing
 * does. `readKnownBans` re-probes before showing a row, and `evaluateAppealEligibility` probes again at submit.
 * The probe is still the only authority; this is the hint getting good enough to be worth having.
 *
 * What it buys is the whole first-run experience. Before, an appellant had to already know which server banned
 * them and paste an invite to it before anything appeared; now they sign in and their bans are simply listed.
 *
 * Two bounds keep it from being the thing §4 warned about:
 *
 * - **Only guilds that actually accept appeals.** No `appeals_settings` row, no insert -- otherwise the list
 *   would offer servers where opening the entry answers `NOT_CONFIGURED`, which is worse than not listing them.
 *   An existing row is still refreshed either way, so a guild that configures Appeals, gets probed, then
 *   unconfigures does not silently go stale.
 * - **Bans only.** `GUILD_BAN_REMOVE` stays `UPDATE`-only: a row saying "not banned" about somebody who has
 *   never used the site is pure storage with nothing on the other end of it.
 *
 * Still incomplete by construction, and that is fine as long as nothing pretends otherwise: bans issued before
 * the bot joined a guild, or while it was down, produce no event and no row. The appellant-facing copy says so.
 */
async function record(guildId: string, userId: string, banned: boolean): Promise<number> {
	const db = getContext().db;

	// `ban_reason` is NULL rather than preserved. GUILD_BAN_ADD carries `{ guild_id, user }` and no reason, so
	// "unknown" is the honest value -- and P8's pattern matching reads the reason the *probe* returns at submit
	// time, not this one, so nothing downstream is weakened by leaving it empty until a probe fills it in.
	if (banned) {
		const rows = await db`
			INSERT INTO appeal_ban_checks (user_id, guild_id, banned, ban_reason)
			SELECT ${userId}, ${guildId}, true, NULL
			-- The first arm is the new behaviour: a ban in a guild that accepts appeals is worth recording for
			-- anyone. The second preserves the old one exactly -- a pair we already track stays fresh even if that
			-- guild has since dropped its config, because a stale row is worse than either alternative.
			WHERE EXISTS (SELECT 1 FROM appeals_settings WHERE guild_id = ${guildId})
				OR EXISTS (SELECT 1 FROM appeal_ban_checks WHERE user_id = ${userId} AND guild_id = ${guildId})
			ON CONFLICT (user_id, guild_id) DO UPDATE SET
				banned = true,
				ban_reason = NULL,
				checked_at = now()
		`;

		return rows.count;
	}

	const rows = await db`
		UPDATE appeal_ban_checks
		SET banned = false, ban_reason = NULL, checked_at = now()
		WHERE user_id = ${userId} AND guild_id = ${guildId}
	`;

	return rows.count;
}

/**
 * Closes an open appeal whose ban has just been lifted by somebody other than the appeal itself (#232 P4b).
 *
 * Without this the appeal sits `PENDING` forever, and the damage is not cosmetic: `evaluateAppealEligibility`
 * refuses a new appeal on an open one **before** it probes the ban, so the stale row locks that user out of
 * appealing in this guild again -- including for some future ban they have not received yet -- and eats one of
 * their `max_appeals` attempts on the way.
 *
 * **This never fires for our own approvals**, and that is a property of P4's ordering rather than a check here:
 * `applyAppealDecision` commits the claim *before* calling Discord, so by the time the gateway echoes the unban
 * back the appeal is already `APPROVED` and `getOpenAppeal` finds nothing. Moving the claim after the unban
 * would silently turn every approval into a race between the two.
 */
async function closeMootAppeal(guildId: string, userId: string, logger: Logger): Promise<void> {
	const appeal = await getOpenAppeal(guildId, userId, APPEAL_KIND_BAN);
	if (!appeal) {
		return;
	}

	const result = await applyAppealDecision({
		appealId: appeal.id,
		status: APPEAL_STATUS.MOOT,
		// Nobody decided it, which is what the appellant is shown and what `appeals_decision_check` enforces for
		// this status.
		moderator: null,
	});

	if (!result.ok) {
		// `raced` here means a moderator decided it in the window between the unban and this handler. Their
		// decision stands; there is nothing left to close.
		appealDecisions.inc({ decision: 'moot', outcome: result.reason });
		return;
	}

	appealDecisions.inc({ decision: 'moot', outcome: 'applied' });
	logger.info({ appealId: appeal.id }, 'closed an appeal as moot, its ban was lifted elsewhere');

	await refreshAppealCard(result.appeal, logger);
}

export function registerBanEvents(client: Client): void {
	for (const [event, kind, banned] of [
		[GatewayDispatchEvents.GuildBanAdd, 'add', true],
		[GatewayDispatchEvents.GuildBanRemove, 'remove', false],
	] as const) {
		// The try/catch is mandatory, not defensive: discord.js-core re-emits a rejected listener as an `'error'`
		// event, which `registerFatalErrorHandlers` treats as fatal.
		client.on(event, async ({ data }) => {
			const logger = getContext().logger.child({ event, guildId: data.guild_id, userId: data.user.id });

			try {
				// `recorded` means a row now reflects this event; `uncached` means there was nothing to write. The
				// two answer different questions, and which one is normal depends on the event: an `add` in a
				// configured guild always records, so `add`/`uncached` climbing means bans are arriving from guilds
				// that never finished setup. A `remove` for somebody nobody ever tracked is `uncached` and expected.
				// Either pair climbing at all is what proves the `GuildModeration` intent is delivering.
				const written = await record(data.guild_id, data.user.id, banned);
				banEvents.inc({ kind, outcome: written > 0 ? 'recorded' : 'uncached' });
			} catch (error) {
				banEvents.inc({ kind, outcome: 'failed' });
				logger.error({ err: error }, 'failed to record a ban-list event');
			}

			if (!banned) {
				// Its own try/catch, and after the cache write rather than instead of it: the two are unrelated jobs
				// that happen to share an event, and failing to close an appeal must not cost the probe cache its
				// refresh.
				try {
					await closeMootAppeal(data.guild_id, data.user.id, logger);
				} catch (error) {
					logger.error({ err: error }, 'failed to close an appeal whose ban was lifted elsewhere');
				}
			}
		});
	}
}
