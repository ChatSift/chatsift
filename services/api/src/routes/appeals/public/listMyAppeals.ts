import { getContext } from '@chatsift/backend-core';
import type { AppealAnswers, Appeals } from '@chatsift/db';
import { defineRoute } from '../../../core/route.js';
import { isAppealsAuthed } from '../../../middleware/isAppealsAuthed.js';
import { readBanChecks } from '../../../util/appealsBans.js';
import type { PublicAppeal } from '../../../util/appealsPublic.js';
import { toPublicAppeal } from '../../../util/appealsPublic.js';
import type { GuildSummary } from '../../../util/guildSummary.js';
import { fetchGuildSummary } from '../../../util/guildSummary.js';

export interface MyAppeal extends PublicAppeal {
	/**
	 * `null` when the Appeals bot can no longer see the guild -- the appeal still renders, by its id and its
	 * status, because it is the appellant's own record and losing sight of the server does not unmake it.
	 */
	guild: GuildSummary | null;
}

export interface ListMyAppealsResult {
	appeals: MyAppeal[];
	/**
	 * Servers this appellant has already been probed against and was found banned in, with no appeal filed yet
	 * -- their way back to a guild they checked on a previous visit without having to find the link again.
	 *
	 * A **hint, never an authority** (#232 §4). `appeal_ban_checks` is a cache of past probe results that is
	 * deliberately allowed to go stale, not a ban index: opening one of these re-probes, and submitting probes
	 * again. It is emphatically not "which servers am I banned in?", which this product does not answer -- it
	 * only ever lists guilds the appellant themselves already asked about.
	 */
	recentlyChecked: GuildSummary[];
}

export default defineRoute({
	method: 'get',
	path: '/v3/appeals/mine',
	middleware: isAppealsAuthed({ fallthrough: false }),
	async handler(req): Promise<ListMyAppealsResult> {
		const { sub } = req.appellant;
		const db = getContext().db;

		const [rows, banChecks] = await Promise.all([
			db<Appeals[]>`SELECT * FROM appeals WHERE user_id = ${sub} ORDER BY id DESC`,
			readBanChecks(sub),
		]);

		const answersByAppeal = new Map<number, AppealAnswers[]>();
		if (rows.length) {
			const answers = await db<AppealAnswers[]>`
				SELECT * FROM appeal_answers
				WHERE appeal_id IN ${db(rows.map((row) => row.id))}
				ORDER BY appeal_id ASC, position ASC
			`;

			for (const answer of answers) {
				const existing = answersByAppeal.get(answer.appealId);
				if (existing) {
					existing.push(answer);
				} else {
					answersByAppeal.set(answer.appealId, [answer]);
				}
			}
		}

		const appealGuildIds = new Set(rows.map((row) => row.guildId));
		const checkedGuildIds = banChecks
			.filter((check) => check.banned && !appealGuildIds.has(check.guildId))
			.map((check) => check.guildId);

		// Cached per guild for five minutes and shared with every other reader of the same guild, so a returning
		// appellant with a handful of entries costs Discord nothing on a reload.
		const summaries = new Map(
			await Promise.all(
				[...appealGuildIds, ...checkedGuildIds].map(
					async (guildId) => [guildId, await fetchGuildSummary(guildId, 'APPEALS')] as const,
				),
			),
		);

		return {
			appeals: rows.map((row) => ({
				...toPublicAppeal(
					row,
					(answersByAppeal.get(row.id) ?? []).map(({ position, promptSnapshot, answer }) => ({
						position,
						promptSnapshot,
						answer,
					})),
				),
				guild: summaries.get(row.guildId) ?? null,
			})),
			// A guild the bot can no longer see is dropped rather than rendered nameless: this list exists to be
			// clicked, and there is nothing to appeal to on the other side of it.
			recentlyChecked: checkedGuildIds
				.map((guildId) => summaries.get(guildId))
				.filter((summary): summary is GuildSummary => summary !== null && summary !== undefined),
		};
	},
});
