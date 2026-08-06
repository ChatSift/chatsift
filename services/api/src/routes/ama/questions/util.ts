import { getContext } from '@chatsift/backend-core';
import { getAnswerEmbed, getBaseEmbeds } from '@chatsift/core';
import type { AmaQuestionAskers, AmaQuestions, AmaSessions } from '@chatsift/db';
import type { APIAttachment, APIEmbed, APIUser, Snowflake } from '@discordjs/core';
import { CDNRoutes, ImageFormat, RouteBases } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { apiForGuild, discordAPIAma } from '../../../util/discordAPI.js';

/**
 * Resolves a raw Discord user id to the full `APIUser` via the AMA bot's own token -- mirrors
 * `modmail/threads/util.ts`'s identically-shaped `resolveUser` (kept as a separate copy since it's
 * pinned to a different bot id and there's no shared cross-product home for it yet). Falls back to
 * the bare snowflake on a 404 rather than failing the whole request over one unresolvable id.
 */
export async function resolveAmaUser(guildId: Snowflake, userId: Snowflake): Promise<APIUser | Snowflake> {
	try {
		return await apiForGuild('AMA', guildId).users.get(userId);
	} catch (error) {
		if (error instanceof DiscordAPIError && error.status === 404) {
			return userId;
		}

		throw error;
	}
}

/**
 * Best-effort display name for embed rebuilding (duplicate merges) -- unlike `resolveAmaUser`, callers
 * here only need a label to print, not the full `APIUser`/fallback-snowflake union, so failures just
 * degrade to the raw id instead of needing to be unwrapped by every call site.
 */
export async function resolveAmaDisplayName(guildId: Snowflake, userId: Snowflake): Promise<string> {
	const resolved = await resolveAmaUser(guildId, userId);
	return typeof resolved === 'string' ? resolved : (resolved.global_name ?? resolved.username);
}

export interface CurrentQueueMessage {
	channelId: string;
	messageId: string;
}

/**
 * Resolves which (channelId, messageId) pair currently displays a question, if any -- mirrors
 * `services/ama-bot`'s `markDuplicateSelect.ts` (kept as a separate copy for the same reason
 * `resolveAmaUser` is: different service, different API client, no shared cross-service home for it
 * yet). A question can be mid-flight with no live message at all (dash-only stage), in which case
 * there's nothing to refresh, clean up, or read attachments back from.
 */
export function resolveCurrentQueueMessage(question: AmaQuestions, session: AmaSessions): CurrentQueueMessage | null {
	if (question.state === 'PENDING_MOD_REVIEW' && session.modQueueId && question.modQueueMessageId) {
		return { channelId: session.modQueueId, messageId: question.modQueueMessageId };
	}

	if (question.state === 'PENDING_GUEST_REVIEW' && session.guestQueueId && question.guestQueueMessageId) {
		return { channelId: session.guestQueueId, messageId: question.guestQueueMessageId };
	}

	if (question.state === 'FLAGGED' && session.flaggedQueueId && question.flaggedQueueMessageId) {
		return { channelId: session.flaggedQueueId, messageId: question.flaggedQueueMessageId };
	}

	// APPROVED has no queue message "of its own" -- when prepared answers hold a question here, the last
	// queue message it actually got posted to (guest queue takes priority, since that's the later stage)
	// is left in place with its button swapped for a disabled/Send one rather than deleted, and the
	// question's own {mod,guest}_queue_message_id keeps pointing at it. Without this, an approved
	// question's attachments would resolve to `[]` the moment it left PENDING_*_REVIEW, well before it's
	// actually sent.
	if (question.state === 'APPROVED') {
		if (session.guestQueueId && question.guestQueueMessageId) {
			return { channelId: session.guestQueueId, messageId: question.guestQueueMessageId };
		}

		if (session.modQueueId && question.modQueueMessageId) {
			return { channelId: session.modQueueId, messageId: question.modQueueMessageId };
		}
	}

	if (question.state === 'ASKED' && question.answersMessageId) {
		return { channelId: session.answersChannelId, messageId: question.answersMessageId };
	}

	return null;
}

/**
 * A question's attachments aren't persisted on its own row (see `services/ama-bot`'s `lib/queues.ts`
 * doc comments) -- the bot always carries them forward off the interaction's source message instead.
 * From the API side there's no interaction to read them off, so this fetches the question's current
 * live message (if any) and reads its attachments back from Discord. A dash-only-held question with
 * no live message at all has no recoverable attachments -- returns `[]`, a known limitation rather
 * than a bug (there was never a Discord message to have attachments on in the first place).
 */
export async function resolveQuestionAttachments(
	question: AmaQuestions,
	session: AmaSessions,
): Promise<APIAttachment[]> {
	const current = resolveCurrentQueueMessage(question, session);
	if (!current) {
		return [];
	}

	try {
		const message = await discordAPIAma.channels.getMessage(current.channelId, current.messageId);
		return message.attachments;
	} catch (error) {
		if (error instanceof DiscordAPIError && error.status === 404) {
			return [];
		}

		throw error;
	}
}

/**
 * Builds the embed(s) for a question actually landing in the answers channel -- the question embed
 * (with merged-asker names, if any) plus, when an answer was prepared ahead of time, the second
 * answer embed. Shared by every path that can publish a question directly to `ASKED`
 * (`sendQuestion.ts`'s explicit dashboard Send action, and `updateQuestion.ts`'s direct-approve
 * branches for AMAs with no guest queue/prepared-answers stage) so none of them can drift and forget
 * to include a prepared answer that was set before the direct approve happened.
 */
export async function buildPublishEmbeds(
	guildId: Snowflake,
	question: AmaQuestions,
	session: AmaSessions,
): Promise<APIEmbed[]> {
	const extraAskers = await getContext().db<AmaQuestionAskers[]>`
		SELECT * FROM ama_question_askers WHERE question_id = ${question.id} ORDER BY merged_at ASC
	`;

	const [attachments, user, extraAskerNames] = await Promise.all([
		resolveQuestionAttachments(question, session),
		resolveAmaUser(guildId, question.authorId),
		Promise.all(extraAskers.map(async (row) => resolveAmaDisplayName(guildId, row.authorId))),
	]);

	const embeds = getBaseEmbeds({
		attachments,
		content: question.content,
		extraAskerDisplayNames: extraAskerNames,
		guildId,
		user: typeof user === 'string' ? undefined : user,
		// Leaves room for the answer embed appended below when there's one to append, so a question
		// with the max attachments doesn't blow past Discord's 10-embed cap once the answer is added.
		reserveEmbedSlots: question.answerContent ? 1 : 0,
	});

	if (question.answerContent) {
		const answeredByUser = question.answeredById ? await resolveAmaUser(guildId, question.answeredById) : undefined;
		const answeredByDisplayName =
			typeof answeredByUser === 'string' || !answeredByUser
				? (question.answeredById ?? 'Unknown User')
				: (answeredByUser.global_name ?? answeredByUser.username);
		const answeredByAvatarURL =
			typeof answeredByUser === 'object' && answeredByUser?.avatar
				? `${RouteBases.cdn}${CDNRoutes.userAvatar(answeredByUser.id, answeredByUser.avatar, ImageFormat.PNG)}`
				: undefined;

		embeds.push(
			getAnswerEmbed({
				answerContent: question.answerContent,
				answerImageUrl: question.answerImageUrl,
				answeredByAvatarURL,
				answeredByDisplayName,
			}),
		);
	}

	return embeds;
}
