import { getContext } from '@chatsift/backend-core';
import { MERGE_SOURCE_STATES, MERGE_TARGET_STATES, resolveEmbedsForEdit } from '@chatsift/core';
import type { AmaQuestions, AmaSessions } from '@chatsift/db';
import type { Snowflake } from '@discordjs/core';
import { conflict } from '@hapi/boom';
import { discordAPIAma } from '../../../util/discordAPI.js';
import { buildQuestionEmbeds, resolveCurrentQueueMessage } from './util.js';

/**
 * Merges `duplicates` into `original`: carries over each duplicate's own author, preserved content,
 * and askers (including anyone previously chain-merged into it, with their own preserved content) for
 * the dashboard's merged-duplicate display, and deletes the duplicate rows in one transaction, then
 * best-effort cleans up whichever queue/answers messages the duplicates had and refreshes `original`'s
 * own live Discord message (if any) -- which since #326 shows a count of the extra people who asked it.
 * Shared by the single-question merge route and the bulk-merge route so both go through the exact same
 * DB/Discord side effects.
 *
 * Returns `original` as re-read under the merge's own row lock, so callers echo back its actual current
 * state rather than the snapshot they validated against.
 */
export async function mergeDuplicatesIntoOriginal(
	guildId: Snowflake,
	session: AmaSessions,
	original: AmaQuestions,
	duplicates: AmaQuestions[],
): Promise<AmaQuestions> {
	const db = getContext().db;
	const duplicateIds = duplicates.map((duplicate) => duplicate.id);

	const locked = await db.begin<AmaQuestions>(async (sql) => {
		// Re-validate under lock rather than trusting the callers' earlier (pre-transaction) state checks --
		// those ran against a snapshot that a concurrent request (another merge, an approve/deny, a send)
		// could have invalidated in the gap between that check and this transaction acquiring the rows.
		// `FOR UPDATE` blocks any such concurrent writer on these same rows until this transaction commits.
		// `ORDER BY id` so two merges touching the same pair of rows acquire them in the same order and
		// can't deadlock against each other -- mirrors `services/ama-bot`'s `markDuplicateSelect.ts`.
		const lockedIds = [original.id, ...duplicateIds];
		const lockedRows = await sql<AmaQuestions[]>`
			SELECT * FROM ama_questions WHERE id = ANY(${lockedIds}) ORDER BY id FOR UPDATE
		`;
		const lockedById = new Map(lockedRows.map((row) => [row.id, row]));

		// The target only has to still be *absorbable* (#328: PENDING_REVIEW, APPROVED or ASKED), while every
		// duplicate still has to be PENDING_REVIEW -- merging one away deletes it outright.
		const lockedOriginal = lockedById.get(original.id);
		const duplicatesStillMergeable = duplicateIds.every((id) => {
			const state = lockedById.get(id)?.state;
			return state !== undefined && MERGE_SOURCE_STATES.has(state);
		});
		if (!lockedOriginal || !MERGE_TARGET_STATES.has(lockedOriginal.state) || !duplicatesStillMergeable) {
			throw conflict('one or more questions changed state before the merge could complete');
		}

		for (const duplicate of duplicates) {
			await sql`
				INSERT INTO ama_question_askers (question_id, author_id, content)
				VALUES (${original.id}, ${duplicate.authorId}, ${duplicate.content})
				ON CONFLICT (question_id, author_id) DO NOTHING
			`;

			// Chained merge: anyone previously merged into this duplicate (with their preserved content)
			// carries over to the original.
			await sql`
				INSERT INTO ama_question_askers (question_id, author_id, content)
				SELECT ${original.id}, author_id, content FROM ama_question_askers WHERE question_id = ${duplicate.id}
				ON CONFLICT (question_id, author_id) DO NOTHING
			`;
		}

		await sql`DELETE FROM ama_questions WHERE id = ANY(${duplicateIds})`;

		return lockedOriginal;
	});

	// Best-effort cleanup of whichever of the duplicates' queue messages exist.
	const duplicateMessages: { channelId: string | null; messageId: string | null }[] = duplicates.flatMap(
		(duplicate) => [
			{ channelId: session.queueId, messageId: duplicate.queueMessageId },
			{ channelId: session.answersChannelId, messageId: duplicate.answersMessageId },
		],
	);
	await Promise.all(
		duplicateMessages
			.filter((entry): entry is { channelId: string; messageId: string } => Boolean(entry.channelId && entry.messageId))
			.map(async ({ channelId, messageId }) =>
				discordAPIAma.channels.deleteMessage(channelId, messageId).catch(() => null),
			),
	);

	// Resolved off the *locked* row, never the caller's pre-transaction copy: since #328 an APPROVED
	// target is legal, and it could have been sent (-> ASKED, with a fresh `answers_message_id`) in the
	// gap before the lock -- refreshing from the stale copy would edit the dead queue message and leave
	// the live public post showing the old count.
	const currentMessage = resolveCurrentQueueMessage(locked, session);
	if (currentMessage) {
		// Best-effort: the merge itself (the transaction above, plus the duplicate cleanup) already
		// committed successfully -- a failure anywhere in resolving/posting the refreshed embed (a
		// deleted message, a Discord outage, a rate limit) shouldn't turn an otherwise-successful merge
		// into a 500 for the caller.
		try {
			const embeds = await buildQuestionEmbeds(guildId, locked, session, { kind: currentMessage.kind });
			// `resolveEmbedsForEdit` because these image urls were read straight back off the live message --
			// resending them resolved on a PATCH makes Discord render the image twice (see its doc comment).
			await discordAPIAma.channels.editMessage(currentMessage.channelId, currentMessage.messageId, {
				embeds: resolveEmbedsForEdit(embeds),
			});
		} catch {
			// no-op -- see comment above.
		}
	}

	return locked;
}
