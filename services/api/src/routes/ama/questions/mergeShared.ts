import { getContext } from '@chatsift/backend-core';
import { getBaseEmbeds } from '@chatsift/core';
import type { AmaQuestionAskers, AmaQuestions, AmaSessions } from '@chatsift/db';
import type { Snowflake } from '@discordjs/core';
import { discordAPIAma } from '../../../util/discordAPI.js';
import { resolveAmaDisplayName, resolveAmaUser, resolveCurrentQueueMessage } from './util.js';

// A question can only ever reach FLAGGED from PENDING_MOD_REVIEW (a mod's own separate-handling call),
// ASKED means it's already publicly posted (its answers-channel message gets deleted below), and DENIED
// is already a resolved outcome -- merging any of those away as "just a duplicate" would silently undo a
// decision or destroy public content. Mirrors the dashboard's own `MERGEABLE_STATES`
// (QuestionDetailPanel.tsx / QuestionsList.tsx).
export const MERGEABLE_STATES = new Set(['PENDING_MOD_REVIEW', 'PENDING_GUEST_REVIEW', 'APPROVED']);

/**
 * Merges `duplicates` into `original`: carries over each duplicate's own askers (including anyone
 * previously chain-merged into it) and deletes the duplicate rows in one transaction, then best-effort
 * cleans up whichever queue/answers messages the duplicates had and refreshes `original`'s own live
 * message (if any) once at the end with the full, freshly-queried asker list. Shared by the single-question
 * merge route and the bulk-merge route so both go through the exact same DB/Discord side effects.
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
		for (const duplicate of duplicates) {
			await sql`
				INSERT INTO ama_question_askers (question_id, author_id)
				VALUES (${original.id}, ${duplicate.authorId})
				ON CONFLICT (question_id, author_id) DO NOTHING
			`;

			// Chained merge: anyone previously merged into this duplicate carries over to the original.
			await sql`
				INSERT INTO ama_question_askers (question_id, author_id)
				SELECT ${original.id}, author_id FROM ama_question_askers WHERE question_id = ${duplicate.id}
				ON CONFLICT (question_id, author_id) DO NOTHING
			`;
		}

		await sql`DELETE FROM ama_questions WHERE id = ANY(${duplicateIds})`;
	});

	// Best-effort cleanup of whichever of the duplicates' queue messages exist.
	const duplicateMessages: { channelId: string | null; messageId: string | null }[] = duplicates.flatMap(
		(duplicate) => [
			{ channelId: session.modQueueId, messageId: duplicate.modQueueMessageId },
			{ channelId: session.guestQueueId, messageId: duplicate.guestQueueMessageId },
			{ channelId: session.flaggedQueueId, messageId: duplicate.flaggedQueueMessageId },
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

	// Re-queried fresh rather than accumulated across the loop above -- this is the single source of
	// truth once the duplicates are gone, and stays correct however many duplicates were merged.
	const mergedAskerRows = await db<AmaQuestionAskers[]>`
		SELECT * FROM ama_question_askers WHERE question_id = ${original.id} ORDER BY merged_at ASC
	`;

	const currentMessage = resolveCurrentQueueMessage(original, session);
	if (currentMessage) {
		const [extraAskerNames, user] = await Promise.all([
			Promise.all(mergedAskerRows.map(async (row) => resolveAmaDisplayName(guildId, row.authorId))),
			resolveAmaUser(guildId, original.authorId),
		]);

		const embeds = getBaseEmbeds({
			attachments: [],
			content: original.content,
			extraAskerDisplayNames: extraAskerNames,
			guildId,
			user: typeof user === 'string' ? undefined : user,
		});

		await discordAPIAma.channels
			.editMessage(currentMessage.channelId, currentMessage.messageId, { embeds })
			.catch(() => null);
	}
}
