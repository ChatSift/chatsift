import type {
	APIActionRowComponent,
	APIButtonComponent,
	APIEmbed,
	APIGuildMember,
	APIMessage,
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
 * Discord's own hard cap on embeds per message.
 */
const MAX_EMBEDS_PER_MESSAGE = 10;

/**
 * Represents which queue a question is currently in
 */
export enum CurrentlyInQueue {
	queue,
	answers,
}

/**
 * All `getBaseEmbeds` ever needs off an attachment. Widened from `APIAttachment` so a caller
 * re-rendering an existing message can hand over image urls recovered from that message's own embeds
 * (see `resolveQuestionImageSources`) without fabricating the rest of an attachment payload --
 * `message.attachments` still satisfies it structurally.
 */
export interface QuestionImageSource {
	url: string;
}

interface GetBaseEmbedsOptions {
	attachments: QuestionImageSource[];
	content: string;
	/**
	 * How many *other distinct people* asked this same question -- i.e. rows in `ama_question_askers`
	 * for it, excluding the question's own author (#326). `0`/omitted renders nothing at all.
	 */
	extraAskerCount?: number | undefined;
	guildId: string;
	includeUserId?: boolean | undefined;
	member?: APIGuildMember | undefined;
	/**
	 * Reserves this many embed slots so the total this call produces stays under Discord's 10-embed
	 * cap even after the caller appends more afterward -- e.g. `buildPublishEmbeds`
	 * appending `getAnswerEmbed`'s result onto a question that already has the max attachments.
	 */
	reserveEmbedSlots?: number | undefined;
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
 * Builds the question embed(s) posted to the queue and the answers channel: author name+avatar line,
 * optional footer with the raw user ID for the queue where a reviewer needs to act on it, blurple
 * accent. Merged-duplicate askers show up as a bare count (#326) -- who they are stays a dashboard-only
 * detail (see `ama_question_askers`), since resolving every merged asker's name would cost a Discord
 * user lookup each on a path that re-renders on every merge. Multiple attachments render as a Discord
 * image gallery via the shared-`url` grouping trick (see `GALLERY_ANCHOR_URL` above).
 */
export function getBaseEmbeds({
	attachments,
	content,
	extraAskerCount = 0,
	guildId,
	includeUserId = false,
	member,
	reserveEmbedSlots = 0,
	user,
}: GetBaseEmbedsOptions): APIEmbed[] {
	const authorName = member?.nick ?? user?.global_name ?? user?.username ?? 'Unknown User';
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

	// Set before the no-attachments early return below, not after -- otherwise the (common) attachment-less
	// question silently loses the field. A field costs no embed slot, so this never affects the gallery
	// splitting or `reserveEmbedSlots` maths further down. Phrased as people rather than merges: the
	// underlying rows are unique per `(question_id, author_id)`, so the same person asking twice counts once.
	if (extraAskerCount > 0) {
		mainEmbed.fields = [
			{
				name: 'Also asked by',
				value: extraAskerCount === 1 ? '1 other person' : `${extraAskerCount} other people`,
				inline: false,
			},
		];
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

	// The main embed always takes one of the `MAX_EMBEDS_PER_MESSAGE` slots -- whatever's left over
	// (minus the caller's reserve, e.g. room for `getAnswerEmbed`'s result) is what the gallery can use.
	const maxGalleryEmbeds = Math.max(0, MAX_EMBEDS_PER_MESSAGE - reserveEmbedSlots - 1);
	const galleryEmbeds: APIEmbed[] = attachments.slice(1, 1 + maxGalleryEmbeds).map((attachment) => ({
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

/**
 * Recovers a question's images from a message that's already live, for a re-render that has to keep
 * them.
 *
 * Needed because a question's images are only ever *uploaded* once, onto whichever message was posted
 * first (the queue message, or the answers message for a session with review disabled). Everything
 * posted afterwards just points its embeds at those same CDN urls -- in particular the answers-channel
 * message is created with `{ embeds }` and no files at all, so its own `attachments` array is empty and
 * re-deriving images from it would silently drop them (which is exactly what happens if you rebuild an
 * `ASKED` question's embeds from `message.attachments`).
 *
 * Prefers real attachments when the message has them, and otherwise reads the urls back out of the
 * embeds. `hasAnswerEmbed` drops the trailing answer embed, whose image is the prepared answer's own
 * (`getAnswerEmbed` rebuilds it from `answer_image_url`) rather than part of the question -- the
 * inverse of how `buildQuestionEmbeds`/`markDuplicateSelect` append it.
 */
export function resolveQuestionImageSources(
	message: Pick<APIMessage, 'attachments' | 'embeds'>,
	hasAnswerEmbed: boolean,
): QuestionImageSource[] {
	if (message.attachments.length > 0) {
		return message.attachments;
	}

	const questionEmbeds = hasAnswerEmbed ? message.embeds.slice(0, -1) : message.embeds;
	return questionEmbeds.flatMap((embed) => (embed.image ? [{ url: embed.image.url }] : []));
}

export function createButtonActionRow(buttons: APIButtonComponent[]): APIActionRowComponent<APIButtonComponent> {
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
