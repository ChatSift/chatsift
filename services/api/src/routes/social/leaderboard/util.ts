import { getContext } from '@chatsift/backend-core';
import { calculateUserLevel, resolveHighestReward } from '@chatsift/core';
import type { SocialGuildSettings, SocialRewards, SocialUsers } from '@chatsift/db';
import type { Snowflake } from '@discordjs/core';
import { apiForGuild } from '../../../util/discordAPI.js';
import { fetchGuildRoles } from '../../../util/roles.js';
import type { PublicUserInfo } from '../../../util/users.js';
import { resolveDiscordUser, toPublicUserInfo } from '../../../util/users.js';

/**
 * The reward role a member has actually earned, resolved to something renderable. Carries no role id: the
 * leaderboard only ever draws this, and the public page (see `publicLeaderboard.ts`) has no use for an id it
 * can't do anything with.
 */
export interface LeaderboardReward {
	/**
	 * Discord's integer role colour. `0` is its "no colour" sentinel, which clients render as the default grey
	 * rather than black -- same rule the dashboard's role pickers apply.
	 */
	color: number;
	name: string;
}

export interface LeaderboardEntry extends PublicUserInfo {
	/**
	 * Derived through the guild's curve, never stored -- `null` when the guild has XP tracking on but hasn't
	 * configured `required_xp_base`/`required_xp_multiplier` yet, which is a real state (the bot accrues XP
	 * and levels nobody) and the exact state a P5-migrated row can land in.
	 */
	level: number | null;
	rank: number;
	/**
	 * The highest reward this member currently holds, of either kind -- `null` when the guild configures no
	 * rewards, when this member has reached none of them, or when there's no level to resolve them against.
	 */
	reward: LeaderboardReward | null;
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
 * A `level -> highest reward` lookup for one guild, built once per page rather than per row.
 *
 * The guild's role list comes from `fetchGuildRoles`, which is the redis-backed per-(bot, guild) cache every
 * other route reads roles through -- so a page costs at most one `GET /guilds/{id}/roles` per five minutes,
 * shared with the dashboard's own role reads, rather than anything per member.
 */
async function buildRewardResolver(guildId: Snowflake): Promise<(level: number) => LeaderboardReward | null> {
	const [rewards, roles] = await Promise.all([
		getContext().db<Pick<SocialRewards, 'clean' | 'level' | 'roleId'>[]>`
			SELECT role_id, level, clean FROM social_rewards WHERE guild_id = ${guildId}
		`,
		fetchGuildRoles(guildId, 'SOCIAL'),
	]);

	const roleById = new Map((roles ?? []).map((role) => [role.id, role]));
	// A reward row outlives the role it names -- deleting a role in Discord doesn't delete its `social_rewards`
	// row -- so anything Discord no longer has is dropped rather than rendered: nobody is wearing a deleted
	// role, and the bot can't grant one either. When the roles couldn't be read *at all* (bot removed, an
	// outage) every reward is unresolvable, and the page simply carries no badges instead of claiming the
	// guild's entire ladder was deleted.
	const live = roles === null ? [] : rewards.filter((reward) => roleById.has(reward.roleId));
	const positions = new Map([...roleById].map(([roleId, role]) => [roleId, role.position]));

	return (level: number) => {
		const reward = resolveHighestReward(live, level, positions);
		const role = reward ? roleById.get(reward.roleId) : undefined;

		return role ? { color: role.color, name: role.name } : null;
	};
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
	const { requiredXpBase, requiredXpMultiplier } = settings;
	const curve =
		requiredXpBase === null || requiredXpMultiplier === null
			? null
			: { base: requiredXpBase, multiplier: requiredXpMultiplier };

	// `COUNT(*) OVER ()` rather than a second round trip -- the window runs over the same filtered set the
	// LIMIT slices, which the planner has to materialize for the sort regardless.
	//
	// `xp > 0` excludes rows that exist without anyone having earned anything. Nothing this stack writes
	// creates one (the grant is the insert, and P3 dropped legacy's `/level` upsert), but legacy's `/level`
	// did, so P5 will migrate them in -- a guild's leaderboard shouldn't open on a tail of people who were
	// only ever looked up. `ignored` is the per-user opt-out: they earn nothing, so ranking them is a lie.
	const [rows, resolveReward] = await Promise.all([
		getContext().db<(Pick<SocialUsers, 'userId' | 'xp'> & { total: number })[]>`
			SELECT user_id, xp, COUNT(*) OVER ()::int AS total
			FROM social_users
			WHERE guild_id = ${guildId} AND NOT ignored AND xp > 0
			ORDER BY xp DESC, user_id ASC
			LIMIT ${limit} OFFSET ${offset}
		`,
		// Skipped outright without a curve: rewards are earned at a *level*, and there are no levels to resolve
		// them against until the guild configures one.
		curve === null ? null : buildRewardResolver(guildId),
	]);

	const resolved = await Promise.all(
		// `apiForGuild` per call, not hoisted: it round-robins across the bots installed in this guild, so
		// hoisting it would pin a whole page's lookups to one token's bucket (see its own doc comment).
		rows.map(async (row) => resolveDiscordUser(apiForGuild('SOCIAL', guildId), row.userId)),
	);

	return {
		curve,
		entries: rows.map((row, index) => {
			const level = curve ? calculateUserLevel(curve.base, curve.multiplier, row.xp) : null;

			return {
				...toPublicUserInfo(resolved[index]!),
				level,
				// The list is already ranked by the ORDER BY, so a rank is just this row's position in the whole
				// filtered set. Ties (identical xp) break on `user_id` and therefore rank in an arbitrary but
				// stable order, rather than sharing a number.
				rank: offset + index + 1,
				reward: level === null ? null : (resolveReward?.(level) ?? null),
				xp: row.xp,
			};
		}),
		total: rows[0]?.total ?? (await countLeaderboardRows(guildId)),
	};
}

/**
 * Fallback for the one case the windowed `COUNT(*) OVER ()` above can't answer: an empty page carries no row
 * to read the count off, so it would report `total: 0` and tell the client the guild has nobody ranked at all.
 * That's wrong whenever the page is merely past the end -- a hand-written `offset`, or a bookmarked last page
 * whose rows have since been ignored -- and it strands the client, since the pager derives its page count from
 * `total` and would collapse to a single page with no way back.
 *
 * A second query rather than always counting separately: this only runs on an empty page, where there was no
 * user resolution to do and the request is cheap anyway.
 */
async function countLeaderboardRows(guildId: Snowflake): Promise<number> {
	// Filter kept identical to the page query above -- a count over a different set would be worse than none.
	const [row] = await getContext().db<{ total: number }[]>`
		SELECT COUNT(*)::int AS total
		FROM social_users
		WHERE guild_id = ${guildId} AND NOT ignored AND xp > 0
	`;

	return row?.total ?? 0;
}
