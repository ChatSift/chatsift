import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { AmaQuestions, AmaSessions } from '@chatsift/db';
import type {
	APIActionRowComponent,
	APIAttachment,
	APIButtonComponent,
	APIEmbed,
	APIGuildMember,
	APIMessageTopLevelComponent,
	APIUser,
	RESTPostAPIChannelMessageJSONBody,
} from '@discordjs/core';
import { ButtonStyle, CDNRoutes, ComponentType, ImageFormat, RouteBases } from '@discordjs/core';

/**
 * Prod ChatSift/AMA's `Colors.Blurple` (0x7289da) — reused so the ported answers-channel/queue
 * embeds match what's already live in production.
 */
const BLURPLE = 0x7289da;

/**
 * Discord groups embeds on the same message into an image gallery when they share an identical
 * `url` field. Used to render more than one attachment per question — prod never had this
 * problem since it only ever supported a single legacy `imageUrl`, but main's `allowedQuestionUploads`
 * can be greater than 1.
 */
const GALLERY_ANCHOR_URL = 'https://automoderator.app/ama-gallery-anchor';

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

interface GetBaseEmbedsOptions {
	attachments: APIAttachment[];
	content: string;
	guildId: string;
	includeUserId?: boolean | undefined;
	member?: APIGuildMember | undefined;
	user?: APIUser | undefined;
}

/**
 * Resolves the avatar to show for a question's author, preferring the guild-specific avatar over
 * the global one — mirrors prod ChatSift/AMA's `GuildMember#displayAvatarURL()` priority.
 */
function resolveAvatarURL(
	guildId: string,
	member: APIGuildMember | undefined,
	user: APIUser | undefined,
): string | undefined {
	if (member?.avatar && member.user) {
		return `${RouteBases.cdn}${CDNRoutes.guildMemberAvatar(guildId, member.user.id, member.avatar, ImageFormat.PNG)}`;
	}

	if (user?.avatar) {
		return `${RouteBases.cdn}${CDNRoutes.userAvatar(user.id, user.avatar, ImageFormat.PNG)}`;
	}

	return undefined;
}

/**
 * Builds the question embed(s) posted to every queue and the answers channel, ported to match
 * prod ChatSift/AMA's layout exactly: author name+avatar line (no "Asked by" prefix needed since
 * the author field already carries that), optional footer with the raw user ID for queues where a
 * mod needs to act on it, blurple accent. Multiple attachments render as a Discord image gallery
 * via the shared-`url` grouping trick (prod only ever supported a single legacy image).
 */
function getBaseEmbeds({
	attachments,
	content,
	guildId,
	includeUserId = false,
	member,
	user,
}: GetBaseEmbedsOptions): APIEmbed[] {
	const displayName = member?.nick ?? user?.global_name ?? user?.username ?? 'Unknown User';
	const avatarURL = resolveAvatarURL(guildId, member, user);

	const mainEmbed: APIEmbed = {
		color: BLURPLE,
		description: content,
		author: avatarURL ? { name: displayName, icon_url: avatarURL } : { name: displayName },
	};

	if (includeUserId && user) {
		mainEmbed.footer = avatarURL
			? { text: `${user.username} (${user.id})`, icon_url: avatarURL }
			: { text: `${user.username} (${user.id})` };
	}

	if (attachments.length === 0) {
		return [mainEmbed];
	}

	if (attachments.length === 1) {
		mainEmbed.image = { url: attachments[0]!.url };
		return [mainEmbed];
	}

	mainEmbed.url = GALLERY_ANCHOR_URL;
	mainEmbed.image = { url: attachments[0]!.url };

	const galleryEmbeds: APIEmbed[] = attachments.slice(1).map((attachment) => ({
		color: BLURPLE,
		url: GALLERY_ANCHOR_URL,
		image: { url: attachment.url },
	}));

	return [mainEmbed, ...galleryEmbeds];
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
 * Posts a question to the guest queue with approve/skip buttons
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
