import { getContext } from '@chatsift/backend-core';
import { calculateTotalRequiredXp, calculateUserLevel } from '@chatsift/core';
import type { SocialGuildSettings, SocialInteractionsId } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export interface SocialInteractionUses {
	id: SocialInteractionsId;
	name: string;
	uses: number;
}

export interface SocialRewardReach {
	level: number;
	/**
	 * How many tracked members have enough XP to be at or past this reward's level. Derived from the XP
	 * threshold rather than counted per member -- see the query.
	 */
	memberCount: number;
	roleId: string;
}

export interface SocialStats {
	interactions: {
		/**
		 * The five most-used custom commands, busiest first. Unbounded in principle (a guild can define as many
		 * as Discord allows), so the dashboard renders these as chips, like AMA's per-tag counts.
		 */
		top: SocialInteractionUses[];
		total: number;
		totalUses: number;
	};
	multipliers: {
		channels: number;
		roles: number;
	};
	rewards: {
		/**
		 * Per reward, how far the membership has actually got. Empty when the guild is still inert -- the curve
		 * has no thresholds to compare against until `required_xp_base`/`required_xp_multiplier` are set.
		 */
		reach: SocialRewardReach[];
		total: number;
	};
	users: {
		/**
		 * Level of the single highest-XP member, run through the same curve `/level` uses. `0` when nobody has
		 * earned anything, and also when the guild is inert (an unset curve has no levels to derive).
		 */
		highestLevel: number;
		ignored: number;
		totalXp: number;
		tracked: number;
		/**
		 * Members holding any XP at all -- including ones since opted out, who keep what they earned. `tracked`
		 * counts every row instead, the ones sitting at 0 because they were migrated in or opted out before
		 * earning anything included.
		 */
		withXp: number;
	};
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/social/stats',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<SocialStats> {
		const { guildId } = req.params;
		const db = getContext().db;

		const [[settings], [userTotals], [interactionTotals], topInteractions, rewards, [multipliers]] = await Promise.all([
			db<Pick<SocialGuildSettings, 'requiredXpBase' | 'requiredXpMultiplier'>[]>`
				SELECT required_xp_base, required_xp_multiplier FROM social_guild_settings WHERE guild_id = ${guildId}
			`,
			db<{ highestXp: string | null; ignored: string; totalXp: string | null; tracked: string; withXp: string }[]>`
				SELECT
					COUNT(*) AS tracked,
					COUNT(*) FILTER (WHERE xp > 0) AS with_xp,
					COUNT(*) FILTER (WHERE ignored) AS ignored,
					SUM(xp) AS total_xp,
					MAX(xp) AS highest_xp
				FROM social_users
				WHERE guild_id = ${guildId}
			`,
			db<{ total: string; totalUses: string | null }[]>`
				SELECT COUNT(*) AS total, SUM(uses) AS total_uses
				FROM social_interactions
				WHERE guild_id = ${guildId}
			`,
			db<{ id: SocialInteractionsId; name: string; uses: number }[]>`
				SELECT id, name, uses FROM social_interactions
				WHERE guild_id = ${guildId}
				ORDER BY uses DESC, name ASC
				LIMIT 5
			`,
			db<{ level: number; roleId: string }[]>`
				SELECT role_id, level FROM social_rewards
				WHERE guild_id = ${guildId}
				ORDER BY level ASC
			`,
			db<{ channels: string; roles: string }[]>`
				SELECT
					(SELECT COUNT(*) FROM social_channels WHERE guild_id = ${guildId}) AS channels,
					(SELECT COUNT(*) FROM social_roles WHERE guild_id = ${guildId}) AS roles
			`,
		]);

		const base = settings?.requiredXpBase ?? null;
		const multiplier = settings?.requiredXpMultiplier ?? null;

		// A level is never stored -- it's derived from XP through the guild's own curve (`socialLevel.ts`), so
		// "how many members reached this reward" is really "how many hold at least the XP its level costs".
		//
		// `width_bucket` answers all of them in a single pass: it binary-searches each member's XP against the
		// (ascending, since `rewards` is ordered by level and the curve is monotonic) threshold list and reports
		// which band they landed in. The reach of reward `i` is then every member in band `i + 1` or higher --
		// a suffix sum over a histogram, rather than one `COUNT(*) WHERE xp >= ...` scan per reward.
		let reach: SocialRewardReach[] = [];
		if (rewards.length > 0 && base !== null && multiplier !== null) {
			const thresholds = rewards.map((reward) => calculateTotalRequiredXp(base, multiplier, reward.level));
			const bands = await db<{ band: string; count: string }[]>`
				SELECT width_bucket(xp::numeric, ${thresholds}::numeric[]) AS band, COUNT(*) AS count
				FROM social_users
				WHERE guild_id = ${guildId}
				GROUP BY band
			`;

			const histogram = new Map(bands.map(({ band, count }) => [Number(band), Number(count)]));
			reach = rewards.map((reward, index) => {
				let memberCount = 0;
				for (const [band, count] of histogram) {
					if (band >= index + 1) {
						memberCount += count;
					}
				}

				return { level: reward.level, roleId: reward.roleId, memberCount };
			});
		}

		const highestXp = Number(userTotals?.highestXp ?? 0);

		return {
			interactions: {
				top: topInteractions.map(({ id, name, uses }) => ({ id, name, uses })),
				total: Number(interactionTotals?.total ?? 0),
				totalUses: Number(interactionTotals?.totalUses ?? 0),
			},
			multipliers: {
				channels: Number(multipliers?.channels ?? 0),
				roles: Number(multipliers?.roles ?? 0),
			},
			rewards: {
				reach,
				total: rewards.length,
			},
			users: {
				highestLevel: base === null || multiplier === null ? 0 : calculateUserLevel(base, multiplier, highestXp),
				ignored: Number(userTotals?.ignored ?? 0),
				totalXp: Number(userTotals?.totalXp ?? 0),
				tracked: Number(userTotals?.tracked ?? 0),
				withXp: Number(userTotals?.withXp ?? 0),
			},
		};
	},
});
