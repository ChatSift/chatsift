import { getContext } from '@chatsift/backend-core';
import type { AmaQuestions, AmaSessions } from '@chatsift/db';
import { ContainerBuilder, MediaGalleryItemBuilder } from '@discordjs/builders';
import type {
	APIActionRowComponent,
	APIAttachment,
	APIButtonComponent,
	APIGuildMember,
	APIMessageTopLevelComponent,
	APIUser,
	RESTPostAPIChannelMessageJSONBody,
} from '@discordjs/core';
import { MessageFlags, ButtonStyle, CDNRoutes, ComponentType, ImageFormat, RouteBases } from '@discordjs/core';
import { client } from './client.js';

/**
 * Represents which queue a question is currently in
 */
export enum CurrentlyInQueue {
	mod,
	guest,
	answers,
}

interface GetNextQueueResult {
	kind: CurrentlyInQueue;
	queueId: string;
}

/**
 * Determines the next queue in the AMA workflow
 */
export function getNextQueue(currently: CurrentlyInQueue, session: AmaSessions): GetNextQueueResult | null {
	switch (currently) {
		case CurrentlyInQueue.answers: {
			return null;
		}

		case CurrentlyInQueue.guest: {
			return { kind: CurrentlyInQueue.answers, queueId: session.answersChannelId };
		}

		case CurrentlyInQueue.mod: {
			if (session.guestQueueId) {
				return { kind: CurrentlyInQueue.guest, queueId: session.guestQueueId };
			}

			return { kind: CurrentlyInQueue.answers, queueId: session.answersChannelId };
		}
	}
}

interface GetBaseContainerOptions {
	attachments: APIAttachment[];
	content: string;
	includeUserId?: boolean | undefined;
	member?: APIGuildMember | undefined;
	user?: APIUser | undefined;
}

/**
 * Creates a base container using Components v2 with question content and attachments.
 * Displays user's name and avatar (prioritizing guild-specific versions).
 */
function getBaseContainer({
	attachments,
	content,
	includeUserId = false,
	member,
	user,
}: GetBaseContainerOptions): ContainerBuilder {
	const container = new ContainerBuilder();

	let footerText: string | undefined;
	if (user) {
		const displayName = member?.nick ?? user.global_name ?? user.username;
		footerText = includeUserId ? `Asked by ${displayName} • ID: ${user.id}` : `Asked by ${displayName}`;
	}

	container.addSectionComponents((section) => {
		// Add the question text and optional footer as a single text block
		const fullContent = footerText ? `${content}\n\n${footerText}` : content;
		section.addTextDisplayComponents((text) => text.setContent(fullContent));

		// Add user avatar as thumbnail (guild avatar takes precedence)
		if (member?.avatar && member.user) {
			// Guild-specific avatar - we need guildId which we don't have here, so fall back to user avatar
			// In practice, guild avatars are rare so this is fine
			const avatarURL = `${RouteBases.cdn}${CDNRoutes.userAvatar(member.user.id, user?.avatar ?? member.user.avatar!, ImageFormat.PNG)}`;
			section.setThumbnailAccessory((thumbnail) => thumbnail.setURL(avatarURL));
		} else if (user?.avatar) {
			// User's global avatar
			const avatarURL = `${RouteBases.cdn}${CDNRoutes.userAvatar(user.id, user.avatar, ImageFormat.PNG)}`;
			section.setThumbnailAccessory((thumbnail) => thumbnail.setURL(avatarURL));
		}

		return section;
	});

	// Add media gallery only if there are attachments
	if (attachments.length > 0) {
		container.addMediaGalleryComponents((gallery) =>
			gallery.addItems(attachments.map((attachment) => new MediaGalleryItemBuilder().setURL(attachment.url))),
		);
	}

	return container;
}

function createButtonActionRow(buttons: APIButtonComponent[]): APIActionRowComponent<APIButtonComponent> {
	return {
		type: ComponentType.ActionRow,
		components: buttons,
	};
}

/**
 * Swaps the action row of a queue message's components for a single disabled button, preserving the
 * question container (and anything else that isn't the button row) instead of dropping it.
 */
export function withResolvedActionRow(
	sourceComponents: APIMessageTopLevelComponent[] | undefined,
	button: APIButtonComponent,
): APIMessageTopLevelComponent[] {
	return (sourceComponents ?? []).map((component) =>
		component.type === ComponentType.ActionRow ? createButtonActionRow([button]) : component,
	);
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
): Promise<TRow | undefined> {
	const runCleanup = async () => {
		try {
			await cleanup(channelId, messageId);
		} catch (error) {
			// Best-effort: a stray message from a lost claim race isn't worth failing the interaction over.
			getContext().logger.debug({ error, channelId, messageId }, 'Failed to clean up message after lost claim race');
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
	member?: APIGuildMember | undefined;
	question: AmaQuestions;
	session: AmaSessions;
	user?: APIUser | undefined;
}

/**
 * Posts a question to the mod queue with approve/deny/flag buttons using Components v2
 */
export async function postToModQueue({ attachments, content, member, question, session, user }: PostToModQueueOptions) {
	if (!session.modQueueId) {
		throw new Error('No mod queue configured for this session');
	}

	const container = getBaseContainer({
		attachments,
		content,
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

	const messageData: RESTPostAPIChannelMessageJSONBody = {
		components: [container.toJSON(), createButtonActionRow(buttons)],
		flags: MessageFlags.IsComponentsV2,
	};

	const message = await client.api.channels.createMessage(session.modQueueId, messageData);
	getContext().logger.info(
		{ questionId: question.id, sessionId: session.id, channelId: session.modQueueId, messageId: message.id },
		'Posted question to mod queue',
	);

	return message;
}

interface PostToGuestQueueOptions {
	attachments: APIAttachment[];
	content: string;
	member?: APIGuildMember | undefined;
	question: AmaQuestions;
	session: AmaSessions;
	user?: APIUser | undefined;
}

/**
 * Posts a question to the guest queue with approve/skip buttons using Components v2
 */
export async function postToGuestQueue({
	attachments,
	content,
	member,
	question,
	session,
	user,
}: PostToGuestQueueOptions) {
	if (!session.guestQueueId) {
		throw new Error('No guest queue configured for this session');
	}

	const container = getBaseContainer({
		attachments,
		content,
		member,
		user,
		includeUserId: false, // Don't include user ID in guest queue
	});

	// Create action buttons for guest queue
	const buttons: APIButtonComponent[] = [
		{
			type: ComponentType.Button,
			style: ButtonStyle.Success,
			label: 'Answer',
			custom_id: `guest-approve:${question.id}`,
		},
		{
			type: ComponentType.Button,
			style: ButtonStyle.Secondary,
			label: 'Skip',
			custom_id: `guest-skip:${question.id}`,
		},
	];

	const messageData: RESTPostAPIChannelMessageJSONBody = {
		components: [container.toJSON(), createButtonActionRow(buttons)],
		flags: MessageFlags.IsComponentsV2,
	};

	const message = await client.api.channels.createMessage(session.guestQueueId, messageData);
	getContext().logger.info(
		{ questionId: question.id, sessionId: session.id, channelId: session.guestQueueId, messageId: message.id },
		'Posted question to guest queue',
	);

	return message;
}

interface PostToFlaggedQueueOptions {
	attachments: APIAttachment[];
	content: string;
	member?: APIGuildMember | undefined;
	question: AmaQuestions;
	session: AmaSessions;
	user?: APIUser | undefined;
}

/**
 * Posts a question to the flagged queue for review using Components v2
 */
export async function postToFlaggedQueue({
	attachments,
	content,
	member,
	question,
	session,
	user,
}: PostToFlaggedQueueOptions) {
	if (!session.flaggedQueueId) {
		throw new Error('No flagged queue configured for this session');
	}

	const container = getBaseContainer({
		attachments,
		content,
		member,
		user,
		includeUserId: true, // Include user ID in flagged queue
	});

	// Flagged questions get approve/deny buttons
	const buttons: APIButtonComponent[] = [
		{
			type: ComponentType.Button,
			style: ButtonStyle.Success,
			label: 'Approve',
			custom_id: `flagged-approve:${question.id}`,
		},
		{
			type: ComponentType.Button,
			style: ButtonStyle.Danger,
			label: 'Deny',
			custom_id: `flagged-deny:${question.id}`,
		},
	];

	const messageData: RESTPostAPIChannelMessageJSONBody = {
		components: [container.toJSON(), createButtonActionRow(buttons)],
		flags: MessageFlags.IsComponentsV2,
	};

	const message = await client.api.channels.createMessage(session.flaggedQueueId, messageData);
	getContext().logger.info(
		{ questionId: question.id, sessionId: session.id, channelId: session.flaggedQueueId, messageId: message.id },
		'Posted question to flagged queue',
	);

	return message;
}

interface PostToAnswersChannelOptions {
	attachments: APIAttachment[];
	content: string;
	member?: APIGuildMember | undefined;
	question: AmaQuestions;
	session: AmaSessions;
	user?: APIUser | undefined;
}

/**
 * Posts an approved question to the answers channel using Components v2
 */
export async function postToAnswersChannel({
	attachments,
	content,
	member,
	question,
	session,
	user,
}: PostToAnswersChannelOptions) {
	const container = getBaseContainer({
		attachments,
		content,
		member,
		user,
		includeUserId: false, // Don't include user ID in answers channel
	});

	const messageData: RESTPostAPIChannelMessageJSONBody = {
		components: [container.toJSON()],
		flags: MessageFlags.IsComponentsV2,
	};

	const message = await client.api.channels.createMessage(session.answersChannelId, messageData);
	getContext().logger.info(
		{ questionId: question.id, sessionId: session.id, channelId: session.answersChannelId, messageId: message.id },
		'Posted question to answers channel',
	);

	return message;
}
