import { getContext } from '@chatsift/backend-core';
import type { QuestionImageSource } from '@chatsift/core';
import { getAnswerEmbed, getBaseEmbeds, resolveQuestionImageSources } from '@chatsift/core';
import type { AmaQuestions, AmaSessions, Database, DatabaseTransaction } from '@chatsift/db';
import type { APIEmbed, APIGuildMember, APIUser, Snowflake } from '@discordjs/core';
import { CDNRoutes, ImageFormat, RouteBases } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { apiForGuild, discordAPIAma } from '../../../util/discordAPI.js';
import { resolveDiscordUser } from '../../../util/users.js';

/**
 * Resolves a raw Discord user id to the full `APIUser` via the AMA bot's own token -- mirrors
 * `modmail/threads/util.ts`'s identically-shaped `resolveUser` (kept as a separate copy since it's
 * pinned to a different bot id and there's no shared cross-product home for it yet). Falls back to
 * the bare snowflake on a 404 rather than failing the whole request over one unresolvable id.
 *
 * Cache-first via `util/users.ts` -- a questions page resolves one author per distinct asker, which
 * without the cache is the exact pattern that saturates Discord's 30-per-30s `GET /users/{id}` bucket.
 */
export async function resolveAmaUser(guildId: Snowflake, userId: Snowflake): Promise<APIUser | Snowflake> {
	return resolveDiscordUser(apiForGuild('AMA', guildId), userId);
}

/**
 * Which of the two message surfaces a question currently lives on. Drives both what the embed shows
 * (the raw user id only ever goes to the mod-facing queue, a prepared answer only ever to the public
 * answers channel) and which message gets edited -- mirrors `services/ama-bot`'s own
 * `CurrentMessage.includeUserId`, made an explicit surface name here since #328 lets a merge refresh
 * either one.
 */
export type QuestionMessageKind = 'answers' | 'queue';

export interface CurrentQueueMessage {
	channelId: string;
	kind: QuestionMessageKind;
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
	// APPROVED has no queue message "of its own" -- when prepared answers hold a question here, the
	// queue message it got posted to is left in place with its button swapped for a disabled/Send one
	// rather than deleted, and the question's own `queue_message_id` keeps pointing at it. Without
	// this, an approved question's attachments would resolve to `[]` the moment it left PENDING_REVIEW,
	// well before it's actually sent.
	if (
		(question.state === 'PENDING_REVIEW' || question.state === 'APPROVED') &&
		session.queueId &&
		question.queueMessageId
	) {
		return { channelId: session.queueId, kind: 'queue', messageId: question.queueMessageId };
	}

	// `answersChannelId` can be null since #316 (a public-page-only AMA). A question submitted under that
	// config reaches 'ASKED' without ever getting an `answers_message_id`, so it falls through to the same
	// "no live message" return as a dash-only-held one. The channel check is load-bearing rather than
	// redundant for the *other* order: an AMA switched to public-page-only after some questions were
	// already posted keeps their `answers_message_id`s, but a message can only be addressed as
	// (channel, message) -- with the channel cleared there is no way to reach it. Those already-posted
	// messages consequently freeze at whatever they last rendered; the dashboard and the public page stay
	// authoritative.
	if (question.state === 'ASKED' && question.answersMessageId && session.answersChannelId) {
		return { channelId: session.answersChannelId, kind: 'answers', messageId: question.answersMessageId };
	}

	return null;
}

/**
 * A question's attachments aren't persisted on its own row (see `services/ama-bot`'s `lib/queues.ts`
 * doc comments) -- the bot always carries them forward off the interaction's source message instead.
 * From the API side there's no interaction to read them off, so this reads them back from Discord.
 *
 * The **queue** message is preferred as the source whenever the question has one, in any state: it's
 * where the files were actually uploaded, it isn't deleted when the question is approved (the button
 * row is swapped, see `markSourceMessageResolved`), and unlike the answers-channel message it has a
 * real `attachments` array. Only a session with review disabled has no queue message at all, and there
 * `resolveQuestionImageSources` recovers the urls out of the live message's own embeds.
 *
 * A dash-only-held question with no live message anywhere has no recoverable images -- returns `[]`, a
 * known limitation rather than a bug (there was never a Discord message to have attachments on).
 */
export async function resolveQuestionAttachments(
	question: AmaQuestions,
	session: AmaSessions,
): Promise<QuestionImageSource[]> {
	const source =
		session.queueId && question.queueMessageId
			? { channelId: session.queueId, messageId: question.queueMessageId }
			: resolveCurrentQueueMessage(question, session);
	if (!source) {
		return [];
	}

	try {
		const message = await discordAPIAma.channels.getMessage(source.channelId, source.messageId);
		return resolveQuestionImageSources(message, Boolean(question.answerContent));
	} catch (error) {
		if (error instanceof DiscordAPIError && error.status === 404) {
			return [];
		}

		throw error;
	}
}

/**
 * How many *other* distinct people asked this same question, i.e. merged-duplicate askers excluding
 * the question's own author (#326). Takes the `sql` handle rather than reaching for the context so
 * callers inside a `db.begin` can count against the same transaction they just merged in.
 *
 * The self-exclusion is load-bearing: nothing stops someone asking twice and a mod merging one of
 * their questions into the other, and the merge INSERT has no guard for it -- without the filter the
 * embed would announce "1 other person" about the author themselves. `::int` because postgres.js hands
 * back a bare `COUNT(*)` (int8) as a string, which every downstream `> 0` check would read as truthy.
 */
export async function countExtraAskers(
	sql: Database | DatabaseTransaction,
	question: Pick<AmaQuestions, 'authorId' | 'id'>,
): Promise<number> {
	const [row] = await sql<{ count: number }[]>`
		SELECT COUNT(*)::int AS count FROM ama_question_askers
		WHERE question_id = ${question.id} AND author_id <> ${question.authorId}
	`;

	return row?.count ?? 0;
}

/**
 * Best-effort guild member lookup for a question's author, so the embed can prefer their nick and
 * guild avatar the way `services/ama-bot`'s own paths (which always have the member off the source
 * interaction) do. Without it an API-side re-render of a bot-posted message would silently swap the
 * displayed name/avatar for the global ones.
 */
async function resolveAmaMember(guildId: Snowflake, userId: Snowflake): Promise<APIGuildMember | undefined> {
	try {
		return await apiForGuild('AMA', guildId).guilds.getMember(guildId, userId);
	} catch {
		// Left the guild, never joined it, or the bot can't see them -- the global name/avatar is a fine
		// fallback, and this whole lookup is cosmetic.
		return undefined;
	}
}

interface BuildQuestionEmbedsOptions {
	/**
	 * Which surface these embeds are headed for -- defaults to `'answers'`, the publishing paths'
	 * behavior. See {@link QuestionMessageKind}.
	 */
	kind?: QuestionMessageKind | undefined;

	/**
	 * The row as the message being edited *currently* renders it, for callers whose `question` is a
	 * projection of an edit that hasn't been written yet (#327's edit of an already-'ASKED' answer).
	 * Defaults to `question`, which is correct for every caller re-rendering from stored state.
	 *
	 * Only {@link resolveQuestionAttachments} reads it, and only for one thing: whether the live message
	 * ends in an answer embed to slice back off before recovering the question's own images. That has to
	 * describe the message as it exists right now, not as it's about to. Passing the projection instead
	 * silently drops the question's image the first time an answer is added to an 'ASKED' question whose
	 * images live in its embeds rather than its attachments (a review-disabled AMA -- see
	 * `resolveQuestionImageSources`), and mis-reads the answer embed's own image as the question's when
	 * an answer is cleared back out.
	 */
	liveQuestion?: AmaQuestions | undefined;
}

/**
 * Builds the embed(s) for a question on either message surface: the question embed (with its
 * merged-duplicate asker count, #326) plus, on the answers channel only, the second answer embed when
 * one was prepared ahead of time. Shared by every path that publishes a question to `ASKED`
 * (`sendQuestion.ts`'s explicit dashboard Send action, and `updateQuestion.ts`'s direct-approve branch
 * for AMAs with no prepared-answers stage) so none of them can drift and forget to include a prepared
 * answer that was set before the direct approve happened -- and by `mergeShared.ts`, which since #328
 * can be refreshing either surface.
 *
 * The answer embed is gated on the surface, not just on `answer_content` being set: an APPROVED
 * question can already have an answer prepared while its queue message is still the live one, and the
 * queue has never shown the answer (matching `services/ama-bot`'s own merge re-render).
 */
export async function buildQuestionEmbeds(
	guildId: Snowflake,
	question: AmaQuestions,
	session: AmaSessions,
	{ kind = 'answers', liveQuestion = question }: BuildQuestionEmbedsOptions = {},
): Promise<APIEmbed[]> {
	const includeAnswer = kind === 'answers' && Boolean(question.answerContent);
	const [attachments, user, member, extraAskerCount] = await Promise.all([
		// `liveQuestion`, not `question` -- this reads the *existing* message back, so it has to be told
		// what that message currently looks like. See the option's own doc comment.
		resolveQuestionAttachments(liveQuestion, session),
		resolveAmaUser(guildId, question.authorId),
		resolveAmaMember(guildId, question.authorId),
		countExtraAskers(getContext().db, question),
	]);

	const embeds = getBaseEmbeds({
		attachments,
		content: question.content,
		extraAskerCount,
		guildId,
		// Mirrors postToQueue's own `includeUserId: true` -- the only surface that ever shows it.
		includeUserId: kind === 'queue',
		member,
		user: typeof user === 'string' ? undefined : user,
		// Leaves room for the answer embed appended below when there's one to append, so a question
		// with the max attachments doesn't blow past Discord's 10-embed cap once the answer is added.
		reserveEmbedSlots: includeAnswer ? 1 : 0,
	});

	if (includeAnswer) {
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
				// Non-null by construction -- `includeAnswer` is exactly `answerContent` being set (plus the
				// surface check), which TS can't narrow through the intermediate boolean.
				answerContent: question.answerContent!,
				answerImageUrl: question.answerImageUrl,
				answeredByAvatarURL,
				answeredByDisplayName,
			}),
		);
	}

	return embeds;
}
