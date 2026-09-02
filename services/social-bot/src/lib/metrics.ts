import { Counter, Registry } from 'prom-client';

/**
 * Dedicated registry rather than prom-client's process-wide default, mirroring `automoderator-bot`'s
 * `lib/metrics.ts` and `services/api`'s `core/metrics.ts` (#277).
 *
 * **Collection is unconditional; only exposure is gated** (see `@chatsift/bot-core`'s `metricsServer.ts`).
 *
 * **Cardinality discipline, non-negotiable:** never label by `guild_id`, `user_id`, `channel_id` or
 * `message_id`. Every label below is drawn from a closed set known at compile time.
 *
 * Social's diagnosability bias is the sharper one here: NASCAR is effectively its only client, so a fault
 * affects one server that will notice immediately and a stack that reports nothing about why.
 */
export const register = new Registry();

/**
 * Every tracked message resolves to exactly one `outcome`, transcribed from `handleTrackedMessage`'s own early
 * returns -- so these sum to "messages this bot considered", and the shape of the split is the diagnosis:
 *
 * - Flat-zero **everything**: no messages arriving at all, which is what a missing `GuildMessages` intent looks
 *   like. Nothing errors; the bot simply sits there.
 * - Healthy `not_eligible` but flat-zero `granted`: messages arrive and are considered, but no XP is ever
 *   written -- the leveling engine is broken downstream of eligibility.
 * - Everything in `not_configured`: the guild rows aren't there, which is a config problem, not a bot problem.
 *
 * `write_failed` is the XP upsert returning no row, which should be impossible -- it exists because the code
 * already tolerates it silently, and a silent impossible case is worth a number.
 *
 * Bot and webhook messages are deliberately **not** counted: they return before any work and would swamp the
 * series with volume that says nothing about whether the feature works.
 */
export const xpGrants = new Counter({
	name: 'social_xp_grants_total',
	help: 'Tracked messages considered for XP, by what came of it',
	labelNames: ['outcome'] as const,
	registers: [register],
});

/**
 * Level-ups. Unlabelled on purpose: level is an unbounded integer and would be a cardinality leak in slow
 * motion -- the label would grow for as long as anyone keeps chatting.
 */
export const levelUps = new Counter({
	name: 'social_level_ups_total',
	help: 'Level-ups awarded',
	registers: [register],
});

/**
 * Reward-role reconciliations. One `result` per call, not per role: the diff is applied as a single
 * `editMember`, so adds and removes are one operation and splitting them would be inventing a distinction the
 * code doesn't have.
 *
 * `noop` is the diff coming back empty -- the member already holds exactly what their level entitles them to --
 * which is the overwhelmingly common case, since this reconciles on every grant rather than only on level-up.
 * It must not read as a failure.
 *
 * `failed` climbing is almost always role hierarchy (the bot's highest role sitting below a reward role) rather
 * than an outage, and it is invisible to the member: they level up, get told they earned a role, and never
 * receive it. `barred` is the follow-on -- the short cooldown that failure sets -- so a burst of `failed`
 * followed by `barred` is one guild misconfigured, not a spreading problem.
 */
export const rewardRoles = new Counter({
	name: 'social_reward_roles_total',
	help: 'Reward role reconciliations, by result',
	labelNames: ['result'] as const,
	registers: [register],
});

/**
 * Level-up notifications actually attempted, so `mode` never includes `NONE` -- a guild that switched
 * notifications off produces nothing here, which is the correct reading of "nothing was attempted".
 *
 * `channel_fallback` is its own mode rather than a retry of `channel`: reaching it at all means the guild's
 * primary channel is broken, so `channel{result="failed"}` climbing alongside `channel_fallback{result="ok"}`
 * is a guild that looks fine to its members and is one setting away from silence.
 *
 * `dms_closed` is the expected outcome for a large share of DM-mode guilds and is deliberately not `failed`.
 */
export const notifications = new Counter({
	name: 'social_notifications_total',
	help: 'Level-up notifications attempted, by delivery mode and result',
	labelNames: ['mode', 'result'] as const,
	registers: [register],
});

/**
 * prom-client emits no series for a label combination until it is first incremented, so a counter that has
 * legitimately never fired reads as "No data" rather than `0`. See the fuller note in `modmail-bot`'s
 * `lib/metrics.ts`.
 */
function zeroInitialise(): void {
	for (const outcome of [
		'granted',
		'not_configured',
		'user_ignored',
		'channel_ignored',
		'not_eligible',
		'write_failed',
		'no_member',
	]) {
		xpGrants.inc({ outcome }, 0);
	}

	levelUps.inc(0);

	for (const result of ['applied', 'noop', 'barred', 'failed']) {
		rewardRoles.inc({ result }, 0);
	}

	for (const mode of ['dm', 'channel', 'channel_fallback']) {
		for (const result of ['ok', 'failed']) {
			notifications.inc({ mode, result }, 0);
		}
	}

	// Only a DM can bounce off a closed inbox.
	notifications.inc({ mode: 'dm', result: 'dms_closed' }, 0);
}

zeroInitialise();
