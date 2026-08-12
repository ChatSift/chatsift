import { getContext } from '@chatsift/backend-core';
import { calculateUserLevel } from '@chatsift/core';
import type { SocialGuildSettings, SocialUsers } from '@chatsift/db';
import type { Snowflake } from '@discordjs/core';
import { apiForGuild } from '../../../util/discordAPI.js';
import type { PublicUserInfo } from '../../../util/users.js';
import { resolveDiscordUser, toPublicUserInfo } from '../../../util/users.js';

export interface LeaderboardEntry extends PublicUserInfo {
	/**
	 * Derived through the guild's curve, never stored -- `null` when the guild has XP tracking on but hasn't
	 * configured `required_xp_base`/`required_xp_multiplier` yet, which is a real state (the bot accrues XP
	 * and levels nobody) and the exact state a P5-migrated row can land in.
	 */
	level: number | null;
	rank: number;
	xp: number;
}

/**
 * The guild's XP curve, echoed alongside the page so a client can render progress towards the next level
 * with the same `@chatsift/core` helpers the bot levels people with, rather than a second formula.
 */
export interface LeaderboardCurve {
	base: number;
	multiplier: number;
}

export interface LeaderboardPage {
	curve: LeaderboardCurve | null;
	entries: LeaderboardEntry[];
	/**
	 * Rows matching the leaderboard's filter across the whole guild, not just this page -- what the client
	 * needs to know whether a next page exists.
	 */
	total: number;
}

interface BuildLeaderboardOptions {
	guildId: Snowflake;
	limit: number;
	offset: number;
	settings: Pick<SocialGuildSettings, 'requiredXpBase' | 'requiredXpMultiplier'>;
}

/**
 * One ranked page of a guild's `social_users`, shared verbatim by the manager-facing route and the public
 * share-token one. Deliberately the *same* shape for both: the public page must never carry a raw Discord id
 * (see `toPublicUserInfo`), and there is nothing a manager could do with one here -- this surface is
 * read-only, and Social has no per-user write anywhere. One shape means the richer of the two can't
 * accidentally be handed to the anonymous one.
 */
export async function buildLeaderboardPage({
	guildId,
	limit,
	offset,
	settings,
}: BuildLeaderboardOptions): Promise<LeaderboardPage> {
	// `COUNT(*) OVER ()` rather than a second round trip -- the window runs over the same filtered set the
	// LIMIT slices, which the planner has to materialize for the sort regardless.
	//
	// `xp > 0` excludes rows that exist without anyone having earned anything. Nothing this stack writes
	// creates one (the grant is the insert, and P3 dropped legacy's `/level` upsert), but legacy's `/level`
	// did, so P5 will migrate them in -- a guild's leaderboard shouldn't open on a tail of people who were
	// only ever looked up. `ignored` is the per-user opt-out: they earn nothing, so ranking them is a lie.
	const rows = await getContext().db<(Pick<SocialUsers, 'userId' | 'xp'> & { total: number })[]>`
		SELECT user_id, xp, COUNT(*) OVER ()::int AS total
		FROM social_users
		WHERE guild_id = ${guildId} AND NOT ignored AND xp > 0
		ORDER BY xp DESC, user_id ASC
		LIMIT ${limit} OFFSET ${offset}
	`;

	const { requiredXpBase, requiredXpMultiplier } = settings;
	const curve =
		requiredXpBase === null || requiredXpMultiplier === null
			? null
			: { base: requiredXpBase, multiplier: requiredXpMultiplier };

	const resolved = await Promise.all(
		// `apiForGuild` per call, not hoisted: it round-robins across the bots installed in this guild, so
		// hoisting it would pin a whole page's lookups to one token's bucket (see its own doc comment).
		rows.map(async (row) => resolveDiscordUser(apiForGuild('SOCIAL', guildId), row.userId)),
	);

	return {
		curve,
		entries: rows.map((row, index) => ({
			...toPublicUserInfo(resolved[index]!),
			level: curve ? calculateUserLevel(curve.base, curve.multiplier, row.xp) : null,
			// The list is already ranked by the ORDER BY, so a rank is just this row's position in the whole
			// filtered set. Ties (identical xp) break on `user_id` and therefore rank in an arbitrary but
			// stable order, rather than sharing a number.
			rank: offset + index + 1,
			xp: row.xp,
		})),
		total: rows[0]?.total ?? 0,
	};
}
