import type { AutomoderatorCases } from '@chatsift/db';
import type { APIUser, Snowflake } from '@discordjs/core';
import { discordAPIAutomoderator } from '../../../util/discordAPI.js';
import { resolveDiscordUser } from '../../../util/users.js';

export interface CaseWithUsers extends AutomoderatorCases {
	mod: APIUser | Snowflake | null;
	target: APIUser | Snowflake;
}

export async function resolveCaseUsers(cases: readonly AutomoderatorCases[]): Promise<CaseWithUsers[]> {
	const ids = new Set<string>();

	for (const row of cases) {
		ids.add(row.targetId);
		if (row.modId) {
			ids.add(row.modId);
		}
	}

	const entries = await Promise.all(
		[...ids].map(async (id): Promise<[string, APIUser | Snowflake]> => [
			id,
			await resolveDiscordUser(discordAPIAutomoderator, id),
		]),
	);
	const usersById = new Map(entries);

	return cases.map((row) => ({
		...row,
		target: usersById.get(row.targetId)!,
		mod: row.modId ? (usersById.get(row.modId) ?? row.modId) : null,
	}));
}
