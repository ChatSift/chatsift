import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { Threads } from '@chatsift/db';
import type { APIEmbed, APIEmbedAuthor, APIUser, CreateMessageOptions } from '@discordjs/core';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { resolveGlobalAvatarURL, resolveGuildAvatarURL } from './avatars.js';
import type { MemberLike } from './avatars.js';
import { fetchGuildEmojiIds, resolveContentForRelay } from './emojis.js';
import { getAnonReplyLabelTemplate, getGuildInfo } from './guild.js';
import type { RelayAttachmentLike, RelayStickerLike } from './media.js';
import { buildRelayMedia } from './media.js';
import type { MessageLike } from './messageContext.js';
import { resolveEffectiveContent, resolveReplyReferenceId } from './messageContext.js';
import { postReferencedUserEmbeds } from './referencedUserEmbed.js';
import { clearReplyAlertCooldown, resolveReplyAlertMentions } from './replyAlerts.js';
import { templateGuildName } from './templateString.js';
import type { InsertThreadMessageContentOptions, RecordedAttachment } from './threads.js';
import {
	findRepliedToByModMessageId,
	findRepliedToGuildMessageId,
	incrementLocalMessageId,
	insertThreadMessage,
	isRecordingEnabled,
} from './threads.js';

/**
 * Thrown by `relayStaffReplyToUserThread` when the user-facing copy itself couldn't be delivered --
 * DMs closed or the bot blocked (both surface as Discord's `CannotSendMessagesToThisUser`), or the
 * target channel is simply gone (a deleted private thread has the same failure shape). Every caller
 * (`commands/reply.ts`, `commands/replyQuick.ts`, `lib/replyContextMenu.ts`, the snippet resolver in
 * `index.ts`) catches this specifically to surface a distinct message instead of the generic
 * "something went wrong" -- most relevant for DM mode (#216, P4/P5), where "the user closed their DMs"
 * is a routine, not exceptional, thing for staff to run into.
 */
export class UndeliverableUserError extends Error {}

/**
 * Shared by both relay directions: matches the *original* (pre-reupload) attachment list against a
 * posted message's own REST response by filename to pick up the durable, re-hosted CDN url -- see
 * `InsertThreadMessageContentOptions`'s doc comment on why this matters. Falls back to the original url
 * for anything `buildRelayMedia` failed to re-upload (dropped from `posted.attachments`), consistent with
 * the accepted "URL staleness" tradeoff for attachments (#261).
 *
 * The single-image case needs special handling: per `media.ts`'s `buildRelayMedia` doc comment, when
 * exactly one image is being sent, it's claimed into the embed's `image` field rather than riding as a
 * separate gallery entry -- and confirmed live (#261 manual verification) that Discord's message REST
 * response then reports an *empty* top-level `attachments` array for that file entirely. Without this,
 * the single-image case (by far the most common one) would always silently fall through to the stale
 * pre-upload url despite a perfectly good re-hosted one being available on the embed itself.
 */
function buildRecordedAttachments(
	originalAttachments: RelayAttachmentLike[],
	posted: {
		attachments: { content_type?: string | undefined; filename: string; size: number; url: string }[];
		embeds: APIEmbed[];
	},
	/**
	 * Filename of the attachment claimed by the embed's `image` (i.e. `media.embedImageRef` with the
	 * `attachment://` prefix stripped), if any.
	 */
	embedClaimedFilename: string | undefined,
): RecordedAttachment[] {
	const byFilename = new Map(posted.attachments.map((attachment) => [attachment.filename, attachment]));
	const embedImageUrl = posted.embeds[0]?.image?.url;

	return originalAttachments.map((original) => {
		if (original.filename === embedClaimedFilename && embedImageUrl) {
			return {
				contentType: original.content_type ?? null,
				filename: original.filename,
				size: original.size,
				url: embedImageUrl,
			};
		}

		const uploaded = byFilename.get(original.filename);
		return {
			contentType: uploaded?.content_type ?? original.content_type ?? null,
			filename: original.filename,
			size: uploaded?.size ?? original.size,
			url: uploaded?.url ?? original.url,
		};
	});
}

/**
 * Matches prod ChatSift/ModMail's `Colors.Green`/`Colors.Blurple` convention (`sendMemberThreadMessage.ts`/
 * `sendStaffThreadMessage.ts`): user messages and staff replies get different accent colors so the two
 * directions are visually distinguishable at a glance in the mod-forum thread.
 */
const GREEN = 0x57f287;
const BLURPLE = 0x5865f2;

export function identityFooter(user: APIUser, prefix?: string) {
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
export function nicknameAuthor(
	guildId: string,
	member: MemberLike | undefined,
	user: APIUser,
): APIEmbedAuthor | undefined {
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
	/**
	 * Whether this message is a Discord "Forward" (see `lib/messageContext.ts`'s `resolveEffectiveContent`)
	 * -- only consumed when content recording is enabled, to populate `thread_message_content.is_forwarded`.
	 */
	isForwarded: boolean;
	logger: Logger;
	member: MemberLike | undefined;
	messageId: string;
	/**
	 * The raw Discord message id this message is natively replying to (see `lib/messageContext.ts`'s
	 * `resolveReplyReferenceId`), if any -- only consumed when content recording is enabled, to resolve
	 * `thread_message_content.replied_to_thread_message_id`.
	 */
	repliedToMessageId?: string | undefined;
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
	isForwarded,
	logger,
	member,
	messageId,
	repliedToMessageId,
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

	let recordedContent: InsertThreadMessageContentOptions | undefined;
	if (await isRecordingEnabled(thread.guildId)) {
		const repliedTo = repliedToMessageId ? await findRepliedToGuildMessageId(thread.id, repliedToMessageId) : undefined;
		recordedContent = {
			attachments: buildRecordedAttachments(attachments, posted, media.embedImageRef?.replace('attachment://', '')),
			isForwarded,
			repliedToThreadMessageId: repliedTo?.id ?? null,
			stickers: stickers.map((sticker) => ({ formatType: sticker.format_type, id: sticker.id, name: sticker.name })),
			// Deliberately the original `content`, not `resolvedContent` -- the name-only hyperlink downgrade
			// above exists because *Discord itself* won't inline-render a custom emote foreign to the posting
			// guild, a restriction that only applies to the live relayed embed. The dashboard's own renderer
			// (`DiscordMarkdown.tsx`'s `EmojiRenderer`) just hits the emoji CDN directly by id with no such
			// guild-ownership check, so recording the downgraded text here would only make the dashboard worse
			// at rendering these than it's actually capable of.
			text: content,
		};
	}

	await insertThreadMessage({
		anon: false,
		content: recordedContent,
		guildId: thread.guildId,
		guildMessageId: posted.id,
		localThreadMessageId,
		staffId: null,
		threadId: thread.id,
		userId: user.id,
		userMessageId: messageId,
	});

	// #215: this only ever runs against the message the ticket opener themselves just typed (this
	// function is never called for a staff reply, see the doc comment above), so there's no "staff
	// mentioning staff" case to gate on -- every referenced id gets checked, unconditionally, including
	// the author's own.
	await postReferencedUserEmbeds({ content, logger, relayedMessageId: posted.id, thread });
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
	if (!thread.userChannelId) {
		throw new Error(`Thread ${thread.id} has no user_channel_id to relay a reply into`);
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

	// Sent *before* the mod-side log copy, deliberately not in parallel with it (unlike this function's
	// pre-#216 shape) -- if the user side can't be delivered at all (DMs closed/bot blocked, or the
	// target channel is just gone), nothing should be logged or recorded as if a reply actually went
	// out. See `UndeliverableUserError`'s doc comment.
	let relayedMessage;
	try {
		relayedMessage = await getContext().service.client.api.channels.createMessage(thread.userChannelId, {
			embeds: [userFacingEmbed],
			files: media.files,
			// Same reasoning as `relayUserMessageToModThread`'s `pingMentions` -- a mention only notifies
			// from plain `content`, never from inside an embed.
			...(ping ? { content: `<@${thread.userId}>` } : {}),
		});
	} catch (error) {
		if (
			error instanceof DiscordAPIError &&
			(error.code === RESTJSONErrorCodes.CannotSendMessagesToThisUser || error.status === 404)
		) {
			throw new UndeliverableUserError(`Could not deliver a reply to user ${thread.userId} in thread ${thread.id}`, {
				cause: error,
			});
		}

		throw error;
	}

	// The user-facing copy above is the point of no return: everything from here down is mod-side
	// bookkeeping (the log copy, the `thread_messages` row), and a failure in either must not propagate
	// back to the caller (`/reply`, `/reply-q`, the reply context menus, the snippet resolver) as a
	// generic failure -- every one of them reports a plain failure as "nothing was sent" and lets staff
	// retry, which would double-deliver a reply the user already received. Best-effort instead: log and
	// return, accepting a missing log copy / recording gap as the degraded outcome. Matches
	// `lib/threads.ts#incrementLocalMessageId`'s own accepted tradeoff (a gap in local numbering is fine)
	// and `closeThread`'s precedent of catching its own mod-forum log post the same way.
	let logMessage;
	try {
		logMessage = await getContext().service.client.api.channels.createMessage(thread.modThreadId, {
			embeds: [logEmbed],
			files: media.files,
		});
	} catch (error) {
		logger.error(
			{ err: error, threadId: thread.id, localThreadMessageId },
			'Delivered a reply to the user but failed to post its mod-forum log copy',
		);
		return;
	}

	logger.info({ threadId: thread.id, localThreadMessageId, anon }, 'Relayed staff reply to user thread');

	// Staff replies are command-driven (`/reply`, `/reply-q`), never a Discord-native reply/forward, so
	// there's no reply target or sticker concept to resolve here -- just the content text and whatever
	// attachments were actually re-uploaded onto the user-facing copy. `externalImageUrl` (a snippet's
	// fixed image) is deliberately excluded from the claimed-filename check -- it isn't one of `attachments`
	// at all, so there's nothing in `attachments` for it to match against.
	let recordedContent: InsertThreadMessageContentOptions | undefined;
	if (await isRecordingEnabled(thread.guildId)) {
		recordedContent = {
			attachments: buildRecordedAttachments(
				attachments,
				relayedMessage,
				media.embedImageRef?.replace('attachment://', ''),
			),
			isForwarded: false,
			repliedToThreadMessageId: null,
			stickers: [],
			text: content,
		};
	}

	try {
		await insertThreadMessage({
			anon,
			content: recordedContent,
			guildId: thread.guildId,
			guildMessageId: logMessage.id,
			localThreadMessageId,
			staffId: staffUser.id,
			threadId: thread.id,
			userId: thread.userId,
			userMessageId: relayedMessage.id,
		});
	} catch (error) {
		// Same reasoning as the log-copy catch above -- both Discord sends already succeeded, so this is
		// a best-effort bookkeeping write, not something that should turn a delivered reply into a
		// reported failure.
		logger.error(
			{ err: error, threadId: thread.id, localThreadMessageId },
			'Delivered a reply and its mod-forum log copy but failed to record it',
		);
		return;
	}

	// A staffer just replied, so the *next* user message should alert subscribers again right away
	// rather than possibly waiting out a cooldown that started before this reply (see
	// `lib/replyAlerts.ts`).
	await clearReplyAlertCooldown(thread.id);
}

export interface RecordInternalModMessageOptions {
	logger: Logger;
	message: MessageLike & { id: string };
	staffId: string;
	thread: Threads;
}

/**
 * Records a plain message posted directly in the mod-forum thread -- mod-to-mod discussion that never
 * crosses to the user's private thread, as opposed to a relayed user message or a `/reply` log copy
 * (both handled above). Unlike those, there's no "real" cross-thread exchange this row represents on
 * its own, so it's only worth inserting at all when recording is actually on -- gated here rather than
 * at the call site, mirroring `isRecordingEnabled`'s other two call sites for consistency. Attachments/
 * stickers are taken straight off the message itself (no re-upload/matching needed, unlike
 * `buildRecordedAttachments` -- this message already *is* the durable mod-forum copy).
 */
export async function recordInternalModMessage({
	logger,
	message,
	staffId,
	thread,
}: RecordInternalModMessageOptions): Promise<void> {
	if (!(await isRecordingEnabled(thread.guildId))) {
		return;
	}

	const localThreadMessageId = await incrementLocalMessageId(thread.id);
	const effective = resolveEffectiveContent(message);
	const replyReferenceId = resolveReplyReferenceId(message);
	const repliedToThreadMessageId = replyReferenceId
		? ((await findRepliedToByModMessageId(thread.id, replyReferenceId)) ?? null)
		: null;

	await insertThreadMessage({
		anon: false,
		content: {
			attachments: effective.attachments.map((attachment) => ({
				contentType: attachment.content_type ?? null,
				filename: attachment.filename,
				size: attachment.size,
				url: attachment.url,
			})),
			isForwarded: effective.isForwarded,
			repliedToThreadMessageId,
			stickers: effective.stickers.map((sticker) => ({
				formatType: sticker.format_type,
				id: sticker.id,
				name: sticker.name,
			})),
			text: effective.content,
		},
		guildId: thread.guildId,
		guildMessageId: message.id,
		isInternal: true,
		localThreadMessageId,
		staffId,
		threadId: thread.id,
		userId: thread.userId,
		userMessageId: null,
	});

	logger.info({ threadId: thread.id, localThreadMessageId }, 'Recorded internal mod-thread message');
}
