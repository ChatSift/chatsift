import { getContext } from '@chatsift/backend-core';
import type { AppealKind, AppealStatus } from '@chatsift/db';
import type { APIUser, Snowflake } from '@discordjs/core';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { discordAPIAppeals } from '../../util/discordAPI.js';
import { snowflakeSchema } from '../../util/schemas.js';
import { resolveDiscordUser } from '../../util/users.js';
import { APPEAL_KINDS, APPEAL_STATUSES } from './constants.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export interface AppealsDeciderCount {
	count: number;
	deciderId: string;
	user: APIUser | Snowflake;
}

export interface AppealsStats {
	/**
	 * Approvals over decided-by-a-human appeals, as a 0-1 fraction. `null` when nothing has been decided --
	 * a guild with no decisions has no rate, which is not the same as a rate of zero.
	 */
	approvalRate: number | null;
	/**
	 * Mean time from filing to decision, in seconds, over appeals a moderator actually decided -- `null`
	 * until the guild has decided one. Withdrawn and MOOT appeals are excluded: neither took anyone any time
	 * to act on, and counting them would flatter the number.
	 */
	avgDecisionTimeSeconds: number | null;
	byKind: Record<AppealKind, number>;
	byStatus: Record<AppealStatus, number>;
	last30Days: number;
	last7Days: number;
	/**
	 * Denials the appellant can never see (`appeals.silent`). Worth surfacing because it is the one decision
	 * that leaves no trace on the appellant's side, so it is easy to forget how often it is used.
	 */
	silentDenials: number;
	/**
	 * The five moderators who have decided the most appeals here. Resolved live, because no appeals table
	 * stores a username snapshot -- same reason `mod/util.ts` resolves the queue's deciders.
	 */
	topDeciders: AppealsDeciderCount[];
	total: number;
	unappealableUsers: number;
	uniqueAppellants: number;
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/appeals/stats',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<AppealsStats> {
		const { guildId } = req.params;
		const db = getContext().db;

		const [[totals], statusCounts, kindCounts, topDeciders, [unappealable]] = await Promise.all([
			db<
				{
					avgDecisionTimeSeconds: string | null;
					last30Days: string;
					last7Days: string;
					silentDenials: string;
					total: string;
					uniqueAppellants: string;
				}[]
			>`
				SELECT
					COUNT(*) AS total,
					COUNT(*) FILTER (WHERE created_at >= now() - INTERVAL '30 days') AS last_30_days,
					COUNT(*) FILTER (WHERE created_at >= now() - INTERVAL '7 days') AS last_7_days,
					COUNT(*) FILTER (WHERE silent) AS silent_denials,
					COUNT(DISTINCT user_id) AS unique_appellants,
					-- A non-null decided_by_id is what separates a decision from a withdrawal or a MOOT close;
					-- both of those set decided_at too (see the appeals_decision_check constraint).
					EXTRACT(
						EPOCH FROM AVG(decided_at - created_at) FILTER (WHERE decided_by_id IS NOT NULL)
					) AS avg_decision_time_seconds
				FROM appeals
				WHERE guild_id = ${guildId}
			`,
			db<{ count: string; status: AppealStatus }[]>`
				SELECT status, COUNT(*) AS count FROM appeals WHERE guild_id = ${guildId} GROUP BY status
			`,
			db<{ count: string; kind: AppealKind }[]>`
				SELECT kind, COUNT(*) AS count FROM appeals WHERE guild_id = ${guildId} GROUP BY kind
			`,
			db<{ decidedById: string; decidedCount: string }[]>`
				SELECT decided_by_id, COUNT(*) AS decided_count
				FROM appeals
				WHERE guild_id = ${guildId} AND decided_by_id IS NOT NULL
				GROUP BY decided_by_id
				ORDER BY decided_count DESC, decided_by_id ASC
				LIMIT 5
			`,
			db<{ count: string }[]>`
				SELECT COUNT(*) AS count FROM unappealable_users WHERE guild_id = ${guildId}
			`,
		]);

		const byStatus = Object.fromEntries(APPEAL_STATUSES.map((status) => [status, 0])) as Record<AppealStatus, number>;
		for (const { status, count } of statusCounts) {
			byStatus[status] = Number(count);
		}

		const byKind = Object.fromEntries(APPEAL_KINDS.map((kind) => [kind, 0])) as Record<AppealKind, number>;
		for (const { kind, count } of kindCounts) {
			byKind[kind] = Number(count);
		}

		const decided = byStatus.APPROVED + byStatus.DENIED;
		const avgDecisionTimeSeconds = totals?.avgDecisionTimeSeconds;

		return {
			approvalRate: decided === 0 ? null : byStatus.APPROVED / decided,
			avgDecisionTimeSeconds:
				avgDecisionTimeSeconds === null || avgDecisionTimeSeconds === undefined ? null : Number(avgDecisionTimeSeconds),
			byKind,
			byStatus,
			last30Days: Number(totals?.last30Days ?? 0),
			last7Days: Number(totals?.last7Days ?? 0),
			silentDenials: Number(totals?.silentDenials ?? 0),
			topDeciders: await Promise.all(
				topDeciders.map(async ({ decidedById, decidedCount }) => ({
					deciderId: decidedById,
					count: Number(decidedCount),
					user: await resolveDiscordUser(discordAPIAppeals, decidedById),
				})),
			),
			total: Number(totals?.total ?? 0),
			unappealableUsers: Number(unappealable?.count ?? 0),
			uniqueAppellants: Number(totals?.uniqueAppellants ?? 0),
		};
	},
});
