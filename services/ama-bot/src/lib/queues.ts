import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { getBaseEmbeds } from '@chatsift/core';
import type { AmaQuestions, AmaSessions } from '@chatsift/db';
import type {
	APIAttachment,
	APIButtonComponent,
	APIGuildMember,
	APIUser,
	RESTPostAPIChannelMessageJSONBody,
} from '@discordjs/core';
import { ButtonStyle, ComponentType } from '@discordjs/core';

export { CurrentlyInQueue, getNextQueue, withResolvedActionRow } from '@chatsift/core';

function createButtonActionRow(buttons: APIButtonComponent[]) {
	return {
		type: ComponentType.ActionRow as const,
		components: buttons,
	};
}

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

interface PostToModQueueOptions {
	attachments: APIAttachment[];
	content: string;
	logger: Logger;
	member?: APIGuildMember | undefined;
	question: AmaQuestions;
	session: AmaSessions;
	user?: APIUser | undefined;
}

/**
 * Posts a question to the mod queue with approve/deny/flag buttons
 */
export async function postToModQueue({
	attachments,
	content,
	logger,
	member,
	question,
	session,
	user,
}: PostToModQueueOptions) {
	if (!session.modQueueId) {
		throw new Error('No mod queue configured for this session');
	}

	const embeds = getBaseEmbeds({
		attachments,
		content,
		guildId: session.guildId,
		member,
		user,
		includeUserId: true, // Include user ID in mod queue
	});

	// Create action buttons using raw API structures
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
	];

	// Add flag button if flagged queue exists
	if (session.flaggedQueueId) {
		buttons.push({
			type: ComponentType.Button,
			style: ButtonStyle.Secondary,
			label: 'Flag',
			emoji: { name: '⚠️' },
			custom_id: `mod-flag:${question.id}`,
		});
	}

	// Duplicate-merge entry point (#293 follow-up) -- available on the mod queue and guest queue,
	// deliberately not on the flagged queue (that surface stays read-only, see postToFlaggedQueue).
	buttons.push({
		type: ComponentType.Button,
		style: ButtonStyle.Secondary,
		label: 'Mark Duplicate',
		custom_id: `mark-duplicate:${question.id}`,
	});

	const messageData: RESTPostAPIChannelMessageJSONBody = {
		embeds,
		components: [createButtonActionRow(buttons)],
	};

	const message = await getContext().service.client.api.channels.createMessage(session.modQueueId, messageData);
	logger.info(
		{ questionId: question.id, sessionId: session.id, channelId: session.modQueueId, messageId: message.id },
		'Posted question to mod queue',
	);

	return message;
}

interface PostToGuestQueueOptions {
	attachments: APIAttachment[];
	content: string;
	logger: Logger;
	member?: APIGuildMember | undefined;
	question: AmaQuestions;
	session: AmaSessions;
	user?: APIUser | undefined;
}

/**
 * Posts a question to the guest queue. When `session.preparedAnswersEnabled` is off, the primary
 * button posts straight to the answers channel ("Answer", `guest-approve`) — unchanged prod
 * behavior. When on, that same button instead opens the "Add Answer" modal (`guest-add-answer`,
 * #293 follow-up) and nothing gets posted until the dashboard's Send action runs.
 */
export async function postToGuestQueue({
	attachments,
	content,
	logger,
	member,
	question,
	session,
	user,
}: PostToGuestQueueOptions) {
	if (!session.guestQueueId) {
		throw new Error('No guest queue configured for this session');
	}

	const embeds = getBaseEmbeds({
		attachments,
		content,
		guildId: session.guildId,
		member,
		user,
		includeUserId: false, // Don't include user ID in guest queue
	});

	const buttons: APIButtonComponent[] = session.preparedAnswersEnabled
		? [
				{
					type: ComponentType.Button,
					style: ButtonStyle.Success,
					label: 'Add Answer',
					custom_id: `guest-add-answer:${question.id}`,
				},
			]
		: [
				{
					type: ComponentType.Button,
					style: ButtonStyle.Success,
					label: 'Answer',
					custom_id: `guest-approve:${question.id}`,
				},
			];

	buttons.push({
		type: ComponentType.Button,
		style: ButtonStyle.Secondary,
		label: 'Skip',
		custom_id: `guest-skip:${question.id}`,
	});
	buttons.push({
		type: ComponentType.Button,
		style: ButtonStyle.Secondary,
		label: 'Mark Duplicate',
		custom_id: `mark-duplicate:${question.id}`,
	});

	const messageData: RESTPostAPIChannelMessageJSONBody = {
		embeds,
		components: [createButtonActionRow(buttons)],
	};

	const message = await getContext().service.client.api.channels.createMessage(session.guestQueueId, messageData);
	logger.info(
		{ questionId: question.id, sessionId: session.id, channelId: session.guestQueueId, messageId: message.id },
		'Posted question to guest queue',
	);

	return message;
}

interface PostToFlaggedQueueOptions {
	attachments: APIAttachment[];
	content: string;
	logger: Logger;
	member?: APIGuildMember | undefined;
	question: AmaQuestions;
	session: AmaSessions;
	user?: APIUser | undefined;
}

/**
 * Posts a question to the flagged queue. This is a read-only surface for mods — nothing routes
 * out of it via the bot; mods review the reported content here and act on the user directly
 * through Discord's own moderation tools.
 */
export async function postToFlaggedQueue({
	attachments,
	content,
	logger,
	member,
	question,
	session,
	user,
}: PostToFlaggedQueueOptions) {
	if (!session.flaggedQueueId) {
		throw new Error('No flagged queue configured for this session');
	}

	const embeds = getBaseEmbeds({
		attachments,
		content,
		guildId: session.guildId,
		member,
		user,
		includeUserId: true, // Include user ID in flagged queue
	});

	const messageData: RESTPostAPIChannelMessageJSONBody = { embeds };

	const message = await getContext().service.client.api.channels.createMessage(session.flaggedQueueId, messageData);
	logger.info(
		{ questionId: question.id, sessionId: session.id, channelId: session.flaggedQueueId, messageId: message.id },
		'Posted question to flagged queue',
	);

	return message;
}

interface PostToAnswersChannelOptions {
	attachments: APIAttachment[];
	content: string;
	logger: Logger;
	member?: APIGuildMember | undefined;
	question: AmaQuestions;
	session: AmaSessions;
	user?: APIUser | undefined;
}

/**
 * Posts an approved question to the answers channel
 */
export async function postToAnswersChannel({
	attachments,
	content,
	logger,
	member,
	question,
	session,
	user,
}: PostToAnswersChannelOptions) {
	const embeds = getBaseEmbeds({
		attachments,
		content,
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
