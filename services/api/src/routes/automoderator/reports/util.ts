import type { AutomoderatorReporters, AutomoderatorReports } from '@chatsift/db';
import type { APIUser, Snowflake } from '@discordjs/core';
import { discordAPIAutomoderator } from '../../../util/discordAPI.js';
import { resolveDiscordUser } from '../../../util/users.js';

/**
 * The queue's row shape. `reporterCount` rather than the reporters themselves: the list renders "3 people
 * reported this" and nothing more, and joining every reporter into every page would be a second query's worth
 * of rows for data only the detail view shows.
 */
export interface ReportWithUsers extends AutomoderatorReports {
	reporterCount: number;
	target: APIUser | Snowflake;
}

export interface ReporterWithUser extends AutomoderatorReporters {
	reporter: APIUser | Snowflake;
}

/**
 * Resolves the reported accounts for a page of reports. Mirrors `cases/util.ts`'s `resolveCaseUsers` -- one
 * lookup per distinct id, so a queue full of reports about the same person costs one fetch, not one per row.
 */
export async function resolveReportTargets(
	reports: readonly AutomoderatorReports[],
	counts: ReadonlyMap<number, number>,
): Promise<ReportWithUsers[]> {
	const ids = new Set(reports.map((row) => row.targetId));

	const entries = await Promise.all(
		[...ids].map(async (id): Promise<[string, APIUser | Snowflake]> => [
			id,
			await resolveDiscordUser(discordAPIAutomoderator, id),
		]),
	);
	const usersById = new Map(entries);

	return reports.map((row) => ({
		...row,
		target: usersById.get(row.targetId)!,
		reporterCount: counts.get(row.id) ?? 0,
	}));
}

export async function resolveReporters(reporters: readonly AutomoderatorReporters[]): Promise<ReporterWithUser[]> {
	return Promise.all(
		reporters.map(async (row) => ({
			...row,
			reporter: await resolveDiscordUser(discordAPIAutomoderator, row.reporterId),
		})),
	);
}
