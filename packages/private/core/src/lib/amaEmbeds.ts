import type {
	APIActionRowComponent,
	APIAttachment,
	APIButtonComponent,
	APIEmbed,
	APIGuildMember,
	APIMessageTopLevelComponent,
	APIUser,
} from 'discord-api-types/v10';
import { CDNRoutes, ComponentType, ImageFormat, RouteBases } from 'discord-api-types/v10';

/**
 * Discord's blurple accent, used across every AMA queue/answers-channel embed.
 */
export const BLURPLE = 0x7289da;

/**
 * Discord groups embeds on the same message into an image gallery when they share an identical
 * `url` field. Used to render more than one attachment per question — ChatSift/AMA never had this
 * problem since it only ever supported a single `imageUrl`, but main's `allowedQuestionUploads`
 * can be greater than 1.
 */
export const GALLERY_ANCHOR_URL = 'https://automoderator.app/ama-gallery-anchor';

/**
 * Represents which queue a question is currently in
 */
export enum CurrentlyInQueue {
	mod,
	guest,
	answers,
}

interface SessionQueueIds {
	answersChannelId: string;
	guestQueueId: string | null;
}

interface GetNextQueueResult {
	kind: CurrentlyInQueue;
	queueId: string;
}

/**
 * Determines the next queue in the AMA workflow
 */
export function getNextQueue(currently: CurrentlyInQueue, session: SessionQueueIds): GetNextQueueResult | null {
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
	/**
	 * Display names of askers merged into this question via the duplicate-merge flow (#293 follow-up)
	 * -- when present, the author line reads "Asked by X, Y, Z [...and N more]" instead of a single
	 * author. Capped display (first few names + a remainder count) is the caller's responsibility;
	 * this just renders whatever list it's given.
	 */
	extraAskerDisplayNames?: string[] | undefined;
	guildId: string;
	includeUserId?: boolean | undefined;
	member?: APIGuildMember | undefined;
	user?: APIUser | undefined;
}

/**
 * Resolves the avatar to show for a question's author, preferring the guild-specific avatar over
 * the global one.
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
 * Builds the "Asked by X, Y, Z [...and N more]" author name for a question with merged-in duplicate
 * askers (#293 follow-up). Shows up to 3 names verbatim before collapsing the rest into a count, so a
 * question merged many times over doesn't blow out the embed author line.
 */
function buildAuthorName(primaryDisplayName: string, extraAskerDisplayNames: string[] | undefined): string {
	if (!extraAskerDisplayNames?.length) {
		return primaryDisplayName;
	}

	const names = [primaryDisplayName, ...extraAskerDisplayNames];
	const shown = names.slice(0, 3);
	const remaining = names.length - shown.length;

	return `Asked by ${shown.join(', ')}${remaining > 0 ? ` [...and ${remaining} more]` : ''}`;
}

/**
 * Builds the question embed(s) posted to every queue and the answers channel: author name+avatar
 * line (no "Asked by" prefix needed since the author field already carries that, unless this
 * question has merged-in duplicate askers), optional footer with the raw user ID for queues where a
 * mod needs to act on it, blurple accent. Multiple attachments render as a Discord image gallery via
 * the shared-`url` grouping trick (see `GALLERY_ANCHOR_URL` above).
 */
export function getBaseEmbeds({
	attachments,
	content,
	extraAskerDisplayNames,
	guildId,
	includeUserId = false,
	member,
	user,
}: GetBaseEmbedsOptions): APIEmbed[] {
	const displayName = member?.nick ?? user?.global_name ?? user?.username ?? 'Unknown User';
	const authorName = buildAuthorName(displayName, extraAskerDisplayNames);
	const avatarURL = resolveAvatarURL(guildId, member, user);

	const mainEmbed: APIEmbed = {
		color: BLURPLE,
		description: content,
		author: avatarURL ? { name: authorName, icon_url: avatarURL } : { name: authorName },
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

interface GetAnswerEmbedOptions {
	answerContent: string;
	answerImageUrl?: string | null | undefined;
	answeredByAvatarURL?: string | undefined;
	answeredByDisplayName: string;
}

/**
 * Builds the second, answer embed appended to a question once it's been prepared/sent (#293
 * follow-up) -- shape lifted from prod `ChatSift/AMA`'s `add-answer.ts`: description = answer text,
 * optional image, footer "\{displayName\} answered" + their avatar, same blurple accent.
 */
export function getAnswerEmbed({
	answerContent,
	answerImageUrl,
	answeredByAvatarURL,
	answeredByDisplayName,
}: GetAnswerEmbedOptions): APIEmbed {
	const embed: APIEmbed = {
		color: BLURPLE,
		description: answerContent,
		footer: answeredByAvatarURL
			? { text: `${answeredByDisplayName} answered`, icon_url: answeredByAvatarURL }
			: { text: `${answeredByDisplayName} answered` },
	};

	if (answerImageUrl) {
		embed.image = { url: answerImageUrl };
	}

	return embed;
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
