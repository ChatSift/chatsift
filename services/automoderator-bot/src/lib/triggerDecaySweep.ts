import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { schedulerTasks } from './metrics.js';

/**
 * How often the decay runs. Not the decay *period* -- that is `trigger_decay_minutes`, per guild. This is only
 * how often the sweep looks, and the statement below catches up however many periods have elapsed since it last
 * did, so the two are independent: a guild decaying every minute is served correctly by a sweep that runs every
 * five, and by one that has not run since yesterday.
 */
export const TRIGGER_DECAY_SWEEP_INTERVAL_MS = 5 * 60 * 1_000;

/**
 * Bleeds filter triggers off members' counts (P5c, feature 11), so somebody who tripped a filter twice last
 * month is not one hit away from the rung they were three months ago.
 *
 * **Legacy's version was broken in three separate ways, and none of them are reproduced here:**
 *
 * 1. It compared `new Date().getMinutes()` against `updatedAt.getMinutes()` -- minute-of-hour against
 *    minute-of-hour. A row touched at :58 and read at :02 produced -56 and never decayed; one touched at :02 and
 *    read at :58 decayed on a schedule nobody configured. This compares timestamps.
 * 2. Its per-guild cooldown cache was inverted, so the *first* row it saw for any guild was deleted outright
 *    rather than decayed. One statement across every guild has no cache to invert.
 * 3. It decayed `automod_triggers` while the anti-spam runner incremented `filter_triggers`, so the counter
 *    that fed punishments never decayed at all. There is one table here.
 */
export async function sweepTriggerDecay(logger: Logger): Promise<void> {
	const db = getContext().db;

	try {
		// One statement, three parts, because the numbers worth logging are "how many decayed" and "how many
		// were cleared" and a statement has one result set.
		//
		// `floor(elapsed / period)` rather than a flat decrement is what keeps the sweep interval and the decay
		// period independent: a row untouched through twelve periods loses twelve, whether the sweep last ran
		// five minutes ago or the bot has been down all day. And `updated_at` moves forward by exactly the
		// periods consumed rather than to `now()`, so the fractional remainder carries into the next tick
		// instead of being rounded away every time.
		//
		// **`c.count = d.count AND c.updated_at = d.updated_at` is a compare-and-swap, and it is what makes this
		// safe on several replicas** with no lease -- the same job `pardoned_by IS NULL` does in the auto-pardon
		// sweep. `due` is a snapshot, so without it a replica whose snapshot predates another's decay would
		// re-apply a stale `periods` on top of it and decay the row twice. With it, Postgres re-checks the
		// predicate against the committed row version and the second replica simply skips it, picking the row
		// up correctly on its next tick.
		const [result] = await db<{ decayed: number; dropped: number }[]>`
			WITH due AS (
				SELECT c.guild_id, c.user_id, c.count, c.updated_at,
					s.trigger_decay_minutes AS decay,
					floor(extract(epoch FROM now() - c.updated_at) / (s.trigger_decay_minutes * 60))::int AS periods
				FROM automoderator_trigger_counts c
				INNER JOIN automoderator_guild_settings s ON s.guild_id = c.guild_id
				WHERE s.trigger_decay_minutes IS NOT NULL
					AND c.updated_at + make_interval(mins => s.trigger_decay_minutes) <= now()
			),
			-- A count that has decayed to nothing is a member back to a clean slate, and no row is what says so.
			-- Keeping it at zero would leave a row for every member who has ever tripped a filter in every guild
			-- that has ever turned one on, which is a table that only grows.
			dropped AS (
				DELETE FROM automoderator_trigger_counts c
				USING due d
				WHERE c.guild_id = d.guild_id AND c.user_id = d.user_id
					AND c.count = d.count AND c.updated_at = d.updated_at
					AND d.periods >= d.count
				RETURNING 1
			),
			decayed AS (
				UPDATE automoderator_trigger_counts c
				SET count = c.count - d.periods,
					updated_at = c.updated_at + make_interval(mins => d.decay * d.periods)
				FROM due d
				WHERE c.guild_id = d.guild_id AND c.user_id = d.user_id
					AND c.count = d.count AND c.updated_at = d.updated_at
					AND d.periods < d.count
				RETURNING 1
			)
			SELECT
				(SELECT count(*) FROM decayed)::int AS decayed,
				(SELECT count(*) FROM dropped)::int AS dropped
		`;

		const decayed = result?.decayed ?? 0;
		const dropped = result?.dropped ?? 0;

		if (decayed === 0 && dropped === 0) {
			return;
		}

		schedulerTasks.inc({ type: 'trigger_decay', result: 'ok' });
		logger.info({ decayed, dropped }, 'decayed filter trigger counts');
	} catch (error) {
		schedulerTasks.inc({ type: 'trigger_decay', result: 'failed' });
		throw error;
	}
}
