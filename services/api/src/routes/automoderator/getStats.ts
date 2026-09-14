import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorCaseAction, AutomoderatorReportState } from '@chatsift/db';
import type { APIUser, Snowflake } from '@discordjs/core';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { discordAPIAutomoderator } from '../../util/discordAPI.js';
import { snowflakeSchema } from '../../util/schemas.js';
import { resolveDiscordUser } from '../../util/users.js';
import { CASE_ACTIONS, REPORT_STATES } from './constants.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export interface AutomoderatorModeratorCount {
	count: number;
	modId: string;
	/**
	 * The `mod_tag` snapshot from this moderator's most recent case, not an arbitrary one -- see the query.
	 * Kept alongside the live account for the same reason every case row does: `UserBadge` prefers the guild's
	 * own snapshot, so the name reads as whoever filed the cases rather than whoever holds that handle now.
	 */
	modTag: string | null;
	user: APIUser | Snowflake;
}

export interface AutomoderatorStats {
	cases: {
		/**
		 * Timed punishments still in force: an `expires_at` the scheduler hasn't honoured yet. A permanent ban
		 * has no expiry and so never counts here -- this is "what is the bot still holding", not "how many
		 * people are currently punished", which no table can answer without asking Discord.
		 */
		active: number;
		/**
		 * Cases nobody authored -- a filter hit, or a manual action whose audit entry could not be attributed
		 * (`mod_id IS NULL`, see `automoderator_cases.mod_id`). The complement of `topModerators`' population.
		 */
		automated: number;
		byAction: Record<AutomoderatorCaseAction, number>;
		last30Days: number;
		last7Days: number;
		pardoned: number;
		total: number;
		uniqueTargets: number;
	};
	reports: {
		byState: Record<AutomoderatorReportState, number>;
		last30Days: number;
		total: number;
	};
	/**
	 * Top five case authors all-time, busiest first. At most five accounts to resolve, through the same
	 * redis-backed `resolveDiscordUser` the case browser uses, so this adds no meaningful Discord traffic.
	 */
	topModerators: AutomoderatorModeratorCount[];
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/automoderator/stats',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<AutomoderatorStats> {
		const { guildId } = req.params;
		const db = getContext().db;

		const [[caseTotals], caseActionCounts, topModerators, [reportTotals], reportStateCounts] = await Promise.all([
			db<
				{
					active: string;
					automated: string;
					last30Days: string;
					last7Days: string;
					pardoned: string;
					total: string;
					uniqueTargets: string;
				}[]
			>`
				SELECT
					COUNT(*) AS total,
					COUNT(*) FILTER (WHERE created_at >= now() - INTERVAL '30 days') AS last_30_days,
					COUNT(*) FILTER (WHERE created_at >= now() - INTERVAL '7 days') AS last_7_days,
					COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND lifted_at IS NULL) AS active,
					COUNT(*) FILTER (WHERE pardoned_by IS NOT NULL) AS pardoned,
					COUNT(*) FILTER (WHERE mod_id IS NULL) AS automated,
					COUNT(DISTINCT target_id) AS unique_targets
				FROM automoderator_cases
				WHERE guild_id = ${guildId}
			`,
			db<{ actionType: AutomoderatorCaseAction; count: string }[]>`
				SELECT action_type, COUNT(*) AS count
				FROM automoderator_cases
				WHERE guild_id = ${guildId}
				GROUP BY action_type
			`,
			// Grouped by `mod_id` alone, with the tag picked off the newest case rather than joined into the
			// grouping key: `mod_tag` is a per-row snapshot, so a moderator who changed their username mid-career
			// would otherwise split into two rows that each under-count them.
			db<{ caseCount: string; modId: string; modTag: string | null }[]>`
				SELECT
					mod_id,
					(array_agg(mod_tag ORDER BY id DESC))[1] AS mod_tag,
					COUNT(*) AS case_count
				FROM automoderator_cases
				WHERE guild_id = ${guildId} AND mod_id IS NOT NULL
				GROUP BY mod_id
				ORDER BY case_count DESC, mod_id ASC
				LIMIT 5
			`,
			db<{ last30Days: string; total: string }[]>`
				SELECT
					COUNT(*) AS total,
					COUNT(*) FILTER (WHERE created_at >= now() - INTERVAL '30 days') AS last_30_days
				FROM automoderator_reports
				WHERE guild_id = ${guildId}
			`,
			db<{ count: string; state: AutomoderatorReportState }[]>`
				SELECT state, COUNT(*) AS count
				FROM automoderator_reports
				WHERE guild_id = ${guildId}
				GROUP BY state
			`,
		]);

		// Seeded with every enum member at 0 rather than only the ones that came back, for the same reason
		// `getAMAStats.ts` does it: a tile that disappears when its count hits zero reads as a missing feature.
		const byAction = Object.fromEntries(CASE_ACTIONS.map((action) => [action, 0])) as Record<
			AutomoderatorCaseAction,
			number
		>;
		for (const { actionType, count } of caseActionCounts) {
			byAction[actionType] = Number(count);
		}

		const byState = Object.fromEntries(REPORT_STATES.map((state) => [state, 0])) as Record<
			AutomoderatorReportState,
			number
		>;
		for (const { state, count } of reportStateCounts) {
			byState[state] = Number(count);
		}

		return {
			cases: {
				active: Number(caseTotals?.active ?? 0),
				automated: Number(caseTotals?.automated ?? 0),
				byAction,
				last30Days: Number(caseTotals?.last30Days ?? 0),
				last7Days: Number(caseTotals?.last7Days ?? 0),
				pardoned: Number(caseTotals?.pardoned ?? 0),
				total: Number(caseTotals?.total ?? 0),
				uniqueTargets: Number(caseTotals?.uniqueTargets ?? 0),
			},
			reports: {
				byState,
				last30Days: Number(reportTotals?.last30Days ?? 0),
				total: Number(reportTotals?.total ?? 0),
			},
			topModerators: await Promise.all(
				topModerators.map(async ({ modId, modTag, caseCount }) => ({
					modId,
					modTag,
					count: Number(caseCount),
					user: await resolveDiscordUser(discordAPIAutomoderator, modId),
				})),
			),
		};
	},
});
