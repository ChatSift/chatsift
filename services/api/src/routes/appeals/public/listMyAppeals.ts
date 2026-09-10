import { getContext } from '@chatsift/backend-core';
import type { AppealAnswers, Appeals } from '@chatsift/db';
import { defineRoute } from '../../../core/route.js';
import { isAppealsAuthed } from '../../../middleware/isAppealsAuthed.js';
import { readKnownBans } from '../../../util/appealsBans.js';
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
	 * Servers this appellant has checked here and is still banned in, with no appeal filed yet -- their way back
	 * to a guild they looked at on a previous visit without having to find the link again.
	 *
	 * **Not "which servers am I banned in?"** (#232 §4), which this product does not answer and could not answer
	 * honestly. Every entry exists because this appellant personally opened that guild here; nothing primes
	 * `appeal_ban_checks`. Re-established before it is returned -- see `readKnownBans` for what that costs and
	 * when it is skipped.
	 */
	knownBans: GuildSummary[];
}

export default defineRoute({
	method: 'get',
	path: '/v3/appeals/mine',
	middleware: isAppealsAuthed({ fallthrough: false }),
	async handler(req): Promise<ListMyAppealsResult> {
		const { sub } = req.appellant;
		const db = getContext().db;

		// Deliberately uncapped. It is bounded per guild by `max_appeals` but not globally, so an account that has
		// appealed in a great many servers reads them all -- and truncating somebody's own appeal history to keep
		// a page fast is the wrong trade, since the missing rows would be indistinguishable from rows that never
		// existed. If this ever gets slow the answer is pagination, not a silent `LIMIT`.
		const rows = await db<Appeals[]>`SELECT * FROM appeals WHERE user_id = ${sub} ORDER BY id DESC`;
		// Derived before the known-ban read rather than after, so a guild that already has an appeal is dropped
		// from that list *before* it can cost a Discord call to re-confirm a ban nobody is going to act on.
		const appealGuildIds = new Set(rows.map((row) => row.guildId));
		const knownBans = await readKnownBans(sub, appealGuildIds, req.logger);

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

		// Cached per guild for five minutes and shared with every other reader of the same guild, so a returning
		// appellant with a handful of entries costs Discord nothing on a reload.
		const summaries = new Map(
			await Promise.all(
				[...appealGuildIds, ...knownBans.map((check) => check.guildId)].map(
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
			knownBans: knownBans
				.map((check) => summaries.get(check.guildId))
				.filter((summary): summary is GuildSummary => summary !== null && summary !== undefined),
		};
	},
});
