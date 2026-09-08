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
 * `url` field. Used to render more than one attachment per question -- ChatSift/AMA never had this
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
	/**
	 * Renders the question with nothing at all identifying who asked it (#366) -- no author line, no
	 * avatar, and no id footer either. Deliberately not an "Anonymous" placeholder: the request was for
	 * the embed to say nothing about the author, not to announce that it's withholding one.
	 *
	 * Only ever set for the answers channel. The review queue always shows the real author regardless of
	 * the flag -- the people moderating a question need to know whose it is.
	 */
	anonymous?: boolean | undefined;
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
	/**
	 * Whether the merged-asker line renders at all. Only an umbrella question's own toggle ever turns it
	 * off (`ama_questions.show_asker_count`) -- everywhere else the count is the point of having merged.
	 */
	showAskerCount?: boolean | undefined;
	/**
	 * This question was written by staff for duplicates to be merged under (#366) rather than asked by
	 * its author. Only affects the merged-asker line: its author isn't one of the askers, so the count is
	 * the merges alone and reads "Asked by" rather than "Also asked by ... other people".
	 */
	umbrella?: boolean | undefined;
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
 * Builds the question embed(s) posted to the queue and the answers channel: author name+avatar line
 * (unless `anonymous`, #366), optional footer with the raw user ID for the queue where a reviewer needs
 * to act on it, blurple accent. Merged-duplicate askers show up as a bare count (#326) -- who they are stays a dashboard-only
 * detail (see `ama_question_askers`), since resolving every merged asker's name would cost a Discord
 * user lookup each on a path that re-renders on every merge. Multiple attachments render as a Discord
 * image gallery via the shared-`url` grouping trick (see `GALLERY_ANCHOR_URL` above).
 */
export function getBaseEmbeds({
	anonymous = false,
	attachments,
	content,
	extraAskerCount = 0,
	guildId,
	includeUserId = false,
	member,
	reserveEmbedSlots = 0,
	showAskerCount = true,
	umbrella = false,
	user,
}: GetBaseEmbedsOptions): APIEmbed[] {
	const authorName = member?.nick ?? user?.global_name ?? user?.username ?? 'Unknown User';
	const avatarURL = anonymous ? undefined : resolveAvatarURL(guildId, member, user);

	const mainEmbed: APIEmbed = {
		color: BLURPLE,
		description: content,
	};

	// Left off entirely rather than set to a placeholder -- an embed with no `author` renders as just the
	// question text, which is exactly what an anonymous question should look like.
	if (!anonymous) {
		mainEmbed.author = avatarURL ? { name: authorName, icon_url: avatarURL } : { name: authorName };
	}

	if (includeUserId && user && !anonymous) {
		mainEmbed.footer = avatarURL
			? { text: `${user.username} (${user.id})`, icon_url: avatarURL }
			: { text: `${user.username} (${user.id})` };
	}

	// Set before the no-attachments early return below, not after -- otherwise the (common) attachment-less
	// question silently loses the field. A field costs no embed slot, so this never affects the gallery
	// splitting or `reserveEmbedSlots` maths further down. Phrased as people rather than merges: the
	// underlying rows are unique per `(question_id, author_id)`, so the same person asking twice counts once.
	//
	// Still gated on there being a *merge*, not on the head count below being non-zero: without one there's
	// no tally to report, and an anonymous question would otherwise announce "Asked by 1 person" about
	// itself on every single render.
	if (showAskerCount && extraAskerCount > 0) {
		// "Also asked by ... other people" only makes sense next to a visible person it's "other" than
		// (#366): drop the author line and there's nobody for the reader to count from, and an umbrella
		// question's author never asked it in the first place. Both cases switch to a flat head count --
		// which for the anonymous case includes the author the reader can't see, and for the umbrella case
		// doesn't, since they only wrote the wording.
		const authorIsAnAsker = !anonymous && !umbrella;
		// The author counts towards the head count exactly when they asked but aren't shown.
		const askerCount = anonymous && !umbrella ? extraAskerCount + 1 : extraAskerCount;
		const plural = askerCount === 1 ? 'person' : 'people';

		mainEmbed.fields = [
			{
				name: authorIsAnAsker ? 'Also asked by' : 'Asked by',
				value: authorIsAnAsker ? `${askerCount} other ${plural}` : `${askerCount} ${plural}`,
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
