import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { createButtonActionRow, getBaseEmbeds } from '@chatsift/core';
import type { AmaQuestions, AmaSessions } from '@chatsift/db';
import type {
	APIAttachment,
	APIButtonComponent,
	APIGuildMember,
	APIUser,
	RESTPostAPIChannelMessageJSONBody,
} from '@discordjs/core';
import { ButtonStyle, ComponentType } from '@discordjs/core';

export { CurrentlyInQueue, withResolvedActionRow } from '@chatsift/core';

/**
 * Posts a queue message, then runs `claim` (an atomic UPDATE guarded by a WHERE clause) to take ownership
 * of the underlying row. If `claim` throws, or resolves with no row (lost a claim race to another
 * moderator/guest, or the caller-side checks are stale), the just-posted message is cleaned up so we don't
 * leave a stray duplicate behind — in both cases before the caller decides how to report the outcome.
 */
export async function claimAfterPost<TRow>(
	claim: () => Promise<TRow[]>,
	cleanup: (channelId: string, messageId: string) => Promise<unknown>,
	channelId: string,
	messageId: string,
	logger: Logger,
): Promise<TRow | undefined> {
	const runCleanup = async () => {
		try {
			await cleanup(channelId, messageId);
		} catch (error) {
			// Best-effort: a stray message from a lost claim race isn't worth failing the interaction over.
			logger.debug({ err: error, channelId, messageId }, 'Failed to clean up message after lost claim race');
		}
	};

	try {
		const [claimed] = await claim();
		if (!claimed) {
			await runCleanup();
		}

		return claimed;
	} catch (error) {
		await runCleanup();
		throw error;
	}
}

interface PostToQueueOptions {
	attachments: APIAttachment[];
	content: string;
	/**
	 * Merged-duplicate askers (#326) -- omitted for a question being posted for the first time, which by
	 * definition has none yet. See `lib/askers.ts`.
	 */
	extraAskerCount?: number | undefined;
	logger: Logger;
	member?: APIGuildMember | undefined;
	question: AmaQuestions;
	session: AmaSessions;
	user?: APIUser | undefined;
}

/**
 * Posts a question to the queue with approve/deny buttons. Reviewed by mods in Discord here, or by
 * anyone in `session.guestIds` via the dashboard -- both act on the same row.
 */
export async function postToQueue({
	attachments,
	content,
	extraAskerCount,
	logger,
	member,
	question,
	session,
	user,
}: PostToQueueOptions) {
	if (!session.queueId) {
		throw new Error('No queue configured for this session');
	}

	const embeds = getBaseEmbeds({
		attachments,
		content,
		extraAskerCount,
		guildId: session.guildId,
		member,
		user,
		includeUserId: true, // Include user ID in the queue
	});

	const buttons: APIButtonComponent[] = [
		{
			type: ComponentType.Button,
			style: ButtonStyle.Success,
			label: 'Approve',
			custom_id: `mod-approve:${question.id}`,
		},
		{
			type: ComponentType.Button,
			style: ButtonStyle.Danger,
			label: 'Deny',
			custom_id: `mod-deny:${question.id}`,
		},
		{
			type: ComponentType.Button,
			style: ButtonStyle.Secondary,
			label: 'Mark Duplicate',
			custom_id: `mark-duplicate:${question.id}`,
		},
	];

	const messageData: RESTPostAPIChannelMessageJSONBody = {
		embeds,
		components: [createButtonActionRow(buttons)],
	};

	const message = await getContext().service.client.api.channels.createMessage(session.queueId, messageData);
	logger.info(
		{ questionId: question.id, sessionId: session.id, channelId: session.queueId, messageId: message.id },
		'Posted question to queue',
	);

	return message;
}

interface PostToAnswersChannelOptions {
	attachments: APIAttachment[];
	content: string;
	/**
	 * Merged-duplicate askers (#326) -- unlike the queue's, this one is worth passing: a question can
	 * collect duplicates while it sits in review and only then get approved straight through to here.
	 */
	extraAskerCount?: number | undefined;
	logger: Logger;
	member?: APIGuildMember | undefined;
	question: AmaQuestions;
	session: AmaSessions;
	user?: APIUser | undefined;
}

/**
 * Posts an approved question to the answers channel, or resolves `null` when the session has none
 * configured -- a public-page-only AMA (#316), where the question still becomes 'ASKED' but the public
 * answers page is the only place it shows up. Deliberately not the `throw` that `postToQueue` uses for
 * its missing channel: there, a caller reaching it without a `queueId` is a bug, whereas here "no
 * channel" is a supported configuration every caller has to handle.
 */
export async function postToAnswersChannel({
	attachments,
	content,
	extraAskerCount,
	logger,
	member,
	question,
	session,
	user,
}: PostToAnswersChannelOptions) {
	if (!session.answersChannelId) {
		return null;
	}

	const embeds = getBaseEmbeds({
		attachments,
		content,
		extraAskerCount,
		guildId: session.guildId,
		member,
		user,
		includeUserId: false, // Don't include user ID in answers channel
	});

	const messageData: RESTPostAPIChannelMessageJSONBody = { embeds };

	const message = await getContext().service.client.api.channels.createMessage(session.answersChannelId, messageData);
	logger.info(
		{ questionId: question.id, sessionId: session.id, channelId: session.answersChannelId, messageId: message.id },
		'Posted question to answers channel',
	);

	return message;
}
