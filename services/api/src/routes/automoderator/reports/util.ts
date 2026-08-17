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
	/**
	 * The moderator who dismissed or actioned it, resolved the same way the target and reporters are. Without
	 * this the one account the detail view showed as a bare snowflake was the *moderator* -- every other account
	 * on the page had a name.
	 */
	resolvedByUser: APIUser | Snowflake | null;
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
	const ids = new Set<string>();

	for (const row of reports) {
		ids.add(row.targetId);
		if (row.resolvedBy) {
			ids.add(row.resolvedBy);
		}
	}

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
		resolvedByUser: row.resolvedBy ? (usersById.get(row.resolvedBy) ?? row.resolvedBy) : null,
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
