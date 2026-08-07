import { getContext } from '@chatsift/backend-core';
import { getBaseEmbeds } from '@chatsift/core';
import type { AmaQuestions, AmaSessions } from '@chatsift/db';
import type { Snowflake } from '@discordjs/core';
import { conflict } from '@hapi/boom';
import { discordAPIAma } from '../../../util/discordAPI.js';
// Re-exported so `mergeQuestion.ts`/`mergeQuestionsBulk.ts` can keep importing it from here -- the
// definition itself lives in `schemas.ts` since that's the one browser-safe module shared with
// `apps/website`'s merge pickers, and duplicating the set in two places is exactly the drift this
// consolidation is meant to prevent.
import { MERGEABLE_STATES } from '../schemas.js';
import { resolveAmaUser, resolveCurrentQueueMessage, resolveQuestionAttachments } from './util.js';

export { MERGEABLE_STATES } from '../schemas.js';

/**
 * Merges `duplicates` into `original`: carries over each duplicate's own author, preserved content,
 * and askers (including anyone previously chain-merged into it, with their own preserved content) for
 * the dashboard's merged-duplicate display, and deletes the duplicate rows in one transaction, then
 * best-effort cleans up whichever queue/answers messages the duplicates had and refreshes `original`'s
 * own live Discord message (if any) -- which continues to show only `original`'s own author. Shared
 * by the single-question merge route and the bulk-merge route so both go through the exact same
 * DB/Discord side effects.
 */
export async function mergeDuplicatesIntoOriginal(
	guildId: Snowflake,
	session: AmaSessions,
	original: AmaQuestions,
	duplicates: AmaQuestions[],
): Promise<void> {
	const db = getContext().db;
	const duplicateIds = duplicates.map((duplicate) => duplicate.id);

	await db.begin(async (sql) => {
		// Re-validate under lock rather than trusting the callers' earlier (pre-transaction) state checks --
		// those ran against a snapshot that a concurrent request (another merge, an approve/deny, a send)
		// could have invalidated in the gap between that check and this transaction acquiring the rows.
		// `FOR UPDATE` blocks any such concurrent writer on these same rows until this transaction commits.
		const lockedIds = [original.id, ...duplicateIds];
		const locked = await sql<Pick<AmaQuestions, 'id' | 'state'>[]>`
			SELECT id, state FROM ama_questions WHERE id = ANY(${lockedIds}) FOR UPDATE
		`;
		const lockedById = new Map(locked.map((row) => [row.id, row.state]));
		const stillMergeable = lockedIds.every((id) => {
			const state = lockedById.get(id);
			return state !== undefined && MERGEABLE_STATES.has(state);
		});
		if (!stillMergeable) {
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

	// `original` is always PENDING_REVIEW here -- that's the only state left in `MERGEABLE_STATES`, and
	// both call sites (`mergeQuestion.ts`/`mergeQuestionsBulk.ts`) validate against it before this ever
	// runs -- so its only possible live message is the queue message, never the answers-channel post.
	const currentMessage = resolveCurrentQueueMessage(original, session);
	if (currentMessage) {
		// Best-effort: the merge itself (the transaction above, plus the duplicate cleanup) already
		// committed successfully -- a failure anywhere in resolving/posting the refreshed embed (a
		// deleted message, a Discord outage, a rate limit) shouldn't turn an otherwise-successful merge
		// into a 500 for the caller.
		try {
			// Mirrors postToQueue's own `includeUserId: true` -- the only queue that ever shows it.
			const [attachments, user] = await Promise.all([
				resolveQuestionAttachments(original, session),
				resolveAmaUser(guildId, original.authorId),
			]);

			const embeds = getBaseEmbeds({
				attachments,
				content: original.content,
				guildId,
				includeUserId: true,
				user: typeof user === 'string' ? undefined : user,
			});

			await discordAPIAma.channels.editMessage(currentMessage.channelId, currentMessage.messageId, { embeds });
		} catch {
			// no-op -- see comment above.
		}
	}
}
