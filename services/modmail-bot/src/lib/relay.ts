import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { Threads } from '@chatsift/db';
import type { APIEmbed, APIEmbedAuthor, APIGuildMember, APIUser, CreateMessageOptions } from '@discordjs/core';
import { CDNRoutes, ImageFormat, RouteBases } from '@discordjs/core';
import { fetchGuildEmojiIds, resolveContentForRelay } from './emojis.js';
import { getAnonReplyLabelTemplate, getGuildInfo } from './guild.js';
import type { RelayAttachmentLike, RelayStickerLike } from './media.js';
import { buildRelayMedia } from './media.js';
import { clearReplyAlertCooldown, resolveReplyAlertMentions } from './replyAlerts.js';
import { templateGuildName } from './templateString.js';
import { incrementLocalMessageId, insertThreadMessage } from './threads.js';

/**
 * Matches prod ChatSift/ModMail's `Colors.Green`/`Colors.Blurple` convention (`sendMemberThreadMessage.ts`/
 * `sendStaffThreadMessage.ts`): user messages and staff replies get different accent colors so the two
 * directions are visually distinguishable at a glance in the mod-forum thread.
 */
const GREEN = 0x57f287;
const BLURPLE = 0x5865f2;

/**
 * Both call sites pass either a full interaction `APIGuildMember` or the `user`-less
 * `APIGuildMemberNoUser` the gateway attaches to `MESSAGE_CREATE`/`MESSAGE_UPDATE` payloads — this
 * only ever reads `nick`/`avatar`, so it's narrowed to just those instead of requiring the full type.
 */
type MemberLike = Pick<APIGuildMember, 'avatar' | 'nick'>;

/**
 * Global (non-guild-specific) avatar — matches prod's footer, which always uses `user.displayAvatarURL()`.
 */
function resolveGlobalAvatarURL(user: APIUser): string | undefined {
	return user.avatar ? `${RouteBases.cdn}${CDNRoutes.userAvatar(user.id, user.avatar, ImageFormat.PNG)}` : undefined;
}

/**
 * Guild-preferring avatar — matches prod's author icon, which uses `GuildMember#displayAvatarURL()`
 * (guild avatar if set, else falls back to the global one).
 */
function resolveGuildAvatarURL(guildId: string, member: MemberLike | undefined, user: APIUser): string | undefined {
	if (member?.avatar) {
		return `${RouteBases.cdn}${CDNRoutes.guildMemberAvatar(guildId, user.id, member.avatar, ImageFormat.PNG)}`;
	}

	return resolveGlobalAvatarURL(user);
}

function identityFooter(user: APIUser, prefix?: string) {
	const globalAvatarURL = resolveGlobalAvatarURL(user);
	const text = `${prefix ?? ''}${user.username} (${user.id})`;
	return globalAvatarURL ? { text, icon_url: globalAvatarURL } : { text };
}

/**
 * Prod only sets an author line at all when the member has a server nickname — a member with no
 * nickname gets no author, just the footer identity (see `sendMemberThreadMessage.ts`/
 * `sendStaffThreadMessage.ts`). Deliberately not "improved" to always show one: that would just
 * duplicate the same identity that's already in the footer.
 */
function nicknameAuthor(guildId: string, member: MemberLike | undefined, user: APIUser): APIEmbedAuthor | undefined {
	if (!member?.nick) {
		return undefined;
	}

	const iconURL = resolveGuildAvatarURL(guildId, member, user);
	return iconURL ? { name: member.nick, icon_url: iconURL } : { name: member.nick };
}

export interface RelayUserMessageOptions {
	attachments: RelayAttachmentLike[];
	content: string;
	/**
	 * A short note prepended to the embed description — "forwarded" or "replying to #N", see `lib/messageContext.ts`.
	 */
	contextNote?: string | undefined;
	logger: Logger;
	member: MemberLike | undefined;
	messageId: string;
	stickers: RelayStickerLike[];
	thread: Threads;
	user: APIUser;
}

/**
 * Relays a message the user typed in their private thread into the ticket's mod-forum thread.
 * Never called for the reverse direction — mod → user replies are command-driven (`/reply`,
 * `/reply-q`), not message-driven, so plain staff messages in the mod thread are never relayed.
 */
export async function relayUserMessageToModThread({
	attachments,
	contextNote,
	content,
	logger,
	member,
	messageId,
	stickers,
	thread,
	user,
}: RelayUserMessageOptions): Promise<void> {
	const localThreadMessageId = await incrementLocalMessageId(thread.id);

	const author = nicknameAuthor(thread.guildId, member, user);
	const media = await buildRelayMedia(attachments, stickers, logger);
	const guildEmojiIds = await fetchGuildEmojiIds(thread.guildId, getContext().service.client.api, logger);
	const resolvedContent = guildEmojiIds ? resolveContentForRelay(content, guildEmojiIds) : content;
	const description = [contextNote, resolvedContent, media.note].filter(Boolean).join('\n\n');

	const embed: APIEmbed = {
		color: GREEN,
		...(description ? { description } : {}),
		...(author ? { author } : {}),
		...(media.embedImageRef ? { image: { url: media.embedImageRef } } : {}),
		footer: identityFooter(user),
	};

	// Pings, if any, go on the message's plain-text `content` — pinging from inside an embed never
	// actually notifies anyone, so this has to live alongside it rather than in the embed's description.
	const pingMentions = await resolveReplyAlertMentions(thread);
	const messageData: CreateMessageOptions = {
		embeds: [embed],
		files: media.files,
		...(pingMentions ? { content: pingMentions } : {}),
	};

	const posted = await getContext().service.client.api.channels.createMessage(thread.modThreadId, messageData);
	logger.info(
		{ threadId: thread.id, localThreadMessageId, modThreadId: thread.modThreadId },
		'Relayed user message to mod thread',
	);

	await insertThreadMessage({
		anon: false,
		guildId: thread.guildId,
		guildMessageId: posted.id,
		localThreadMessageId,
		staffId: null,
		threadId: thread.id,
		userId: user.id,
		userMessageId: messageId,
	});
}

export interface RelayStaffReplyOptions {
	anon: boolean;
	attachments?: RelayAttachmentLike[] | undefined;
	content: string;
	/**
	 * A snippet's fixed attachment, set directly as the embed's `image.url` rather than routed through
	 * `buildRelayMedia`'s fetch-and-re-upload path -- Discord's own servers fetch/proxy an embed image
	 * URL when rendering it, so this never has the bot's own process making an outbound request to a
	 * staff-supplied URL at all. Mutually exclusive with `attachments` in practice: only the snippet
	 * command resolver passes this, and only `/reply`/`/reply-q` pass `attachments`.
	 */
	externalImageUrl?: string | undefined;
	logger: Logger;
	/**
	 * Whether to mention the user on the relayed copy — surfaced as a `/reply` modal checkbox / `/reply-q`
	 * boolean option, since threads replaced DMs and the user may no longer be watching the thread (#251).
	 * Optional (defaults to `false`) since the snippet-relay call site has no ping option of its own.
	 */
	ping?: boolean | undefined;
	staffMember: MemberLike | undefined;
	staffUser: APIUser;
	thread: Threads;
}

/**
 * Relays a staff reply (from `/reply` or `/reply-q`) both ways: a log message posted into the mod
 * thread (so other staff can see what was sent, including who sent it even when anon) and the
 * relayed copy posted into the user's private thread. Both message ids are real Discord messages
 * this function creates, matching `thread_messages.user_message_id`/`guild_message_id` both being
 * non-nullable columns. The `Reply ID: N` footer is mod-side only, mirroring prod
 * `sendStaffThreadMessage.ts` exactly: it only ever edits that prefix into the guild-side message
 * after the user's copy has already been sent, so the user never sees it — internal bookkeeping,
 * not something to leak to the person who opened the ticket.
 */
export async function relayStaffReplyToUserThread({
	anon,
	attachments = [],
	content,
	externalImageUrl,
	logger,
	ping = false,
	staffMember,
	staffUser,
	thread,
}: RelayStaffReplyOptions): Promise<void> {
	if (!thread.userThreadId) {
		throw new Error(`Thread ${thread.id} has no user_thread_id to relay a reply into`);
	}

	const localThreadMessageId = await incrementLocalMessageId(thread.id);

	const media = await buildRelayMedia(attachments, [], logger);
	const description = [content, media.note].filter(Boolean).join('\n\n');
	const imageUrl = externalImageUrl ?? media.embedImageRef;
	const image = imageUrl ? { image: { url: imageUrl } } : {};

	// Anon: resolve the configurable "{guildName} Team"-style label once, used as the log embed's
	// author (a "sent as" badge — mods still get the real identity from the footer below regardless)
	// and as the *only* identifying thing on the user-facing embed (in its footer, not author — see
	// below). Non-anon: the usual nickname-or-nothing author, same rule the user-message side uses.
	let author: APIEmbedAuthor | undefined;
	let anonFooter: { icon_url?: string; text: string } | undefined;
	if (anon) {
		const [guildInfo, labelTemplate] = await Promise.all([
			getGuildInfo(thread.guildId),
			getAnonReplyLabelTemplate(thread.guildId),
		]);
		const label = templateGuildName(labelTemplate, guildInfo.name);
		author = guildInfo.iconURL ? { name: label, icon_url: guildInfo.iconURL } : { name: label };
		anonFooter = guildInfo.iconURL ? { text: label, icon_url: guildInfo.iconURL } : { text: label };
	} else {
		author = nicknameAuthor(thread.guildId, staffMember, staffUser);
	}

	const logEmbed: APIEmbed = {
		color: BLURPLE,
		description,
		...(author ? { author } : {}),
		...image,
		footer: identityFooter(staffUser, `Reply ID: ${localThreadMessageId} | `),
	};

	// User-facing embed: non-anon shows the same nickname author (if any) plus a plain identity
	// footer, no reply id. Anon deliberately diverges from prod here (which puts "{guild} Team" in
	// the author slot) — that read as duplicated information with the footer, so the anonymized
	// identity lives only in the footer and there's no author line at all.
	const userFacingEmbed: APIEmbed = anon
		? { color: BLURPLE, description, ...image, footer: anonFooter! }
		: { color: BLURPLE, description, ...(author ? { author } : {}), ...image, footer: identityFooter(staffUser) };

	const [logMessage, relayedMessage] = await Promise.all([
		getContext().service.client.api.channels.createMessage(thread.modThreadId, {
			embeds: [logEmbed],
			files: media.files,
		}),
		getContext().service.client.api.channels.createMessage(thread.userThreadId, {
			embeds: [userFacingEmbed],
			files: media.files,
			// Same reasoning as `relayUserMessageToModThread`'s `pingMentions` -- a mention only notifies
			// from plain `content`, never from inside an embed.
			...(ping ? { content: `<@${thread.userId}>` } : {}),
		}),
	]);

	logger.info({ threadId: thread.id, localThreadMessageId, anon }, 'Relayed staff reply to user thread');

	await insertThreadMessage({
		anon,
		guildId: thread.guildId,
		guildMessageId: logMessage.id,
		localThreadMessageId,
		staffId: staffUser.id,
		threadId: thread.id,
		userId: thread.userId,
		userMessageId: relayedMessage.id,
	});

	// A staffer just replied, so the *next* user message should alert subscribers again right away
	// rather than possibly waiting out a cooldown that started before this reply (see
	// `lib/replyAlerts.ts`).
	await clearReplyAlertCooldown(thread.id);
}
