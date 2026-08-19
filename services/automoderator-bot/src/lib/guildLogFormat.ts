import { snowflakeTimestampSeconds } from '@chatsift/core';
import type { APIEmbed } from '@discordjs/core';
import { CDNRoutes, ImageFormat, RouteBases } from '@discordjs/core';

/**
 * The message and profile log embeds (P4, feature 34). Pure builders, kept out of the observers so the wording
 * and the truncation are unit-testable without a gateway.
 *
 * The shapes follow legacy's closely on purpose: a guild migrating at P9 should not find its message log
 * suddenly unrecognizable. What changed is what legacy could not have had -- display names alongside
 * usernames, and an attachment count on a delete instead of the guess legacy printed.
 */

const DELETE_COLOR = 0xed_45_45;
const EDIT_COLOR = 0xf5_9e_0b;
const PROFILE_COLOR = 0x58_65_f2;

/**
 * Discord's per-field-value limit. Content is quoted with `>>>` (three characters) so the budget is one less
 * than the raw 1,024.
 */
const FIELD_VALUE_LIMIT = 1_024;
const QUOTE_PREFIX = '>>> ';

function truncate(value: string, limit: number): string {
	return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

/**
 * Renders message content as a blockquote, or says plainly that there wasn't any. The empty case is not
 * hypothetical: an attachment-only message has `content: ''`, and an embed field cannot be empty, so without
 * this branch the whole log post 400s.
 */
function quoteContent(content: string, emptyText: string): string {
	if (content.length === 0) {
		return emptyText;
	}

	return QUOTE_PREFIX + truncate(content, FIELD_VALUE_LIMIT - QUOTE_PREFIX.length);
}

export interface LogActor {
	readonly avatar: string | null;
	readonly id: string;
	readonly tag: string;
}

function authorLine(actor: LogActor): NonNullable<APIEmbed['author']> {
	const iconUrl = actor.avatar
		? `${RouteBases.cdn}${CDNRoutes.userAvatar(actor.id, actor.avatar, ImageFormat.PNG)}`
		: undefined;

	return iconUrl ? { name: `${actor.tag} (${actor.id})`, icon_url: iconUrl } : { name: `${actor.tag} (${actor.id})` };
}

export interface MessageDeleteLogInput {
	readonly attachmentCount: number;
	readonly author: LogActor;
	readonly channelId: string;
	readonly content: string;
	readonly messageId: string;
	/**
	 * Who deleted it, when the audit log said so. Null covers both "the author deleted their own message" and
	 * "we could not tell" -- see `deleteAttribution.ts` for why those two are not distinguishable in general.
	 */
	readonly moderator: LogActor | null;
}

export function buildMessageDeleteEmbed(input: MessageDeleteLogInput): APIEmbed {
	const posted = snowflakeTimestampSeconds(input.messageId);

	const embed: APIEmbed = {
		color: DELETE_COLOR,
		author: authorLine(input.author),
		description: `Message deleted, posted <t:${posted}:R> in <#${input.channelId}>`,
		fields: [
			{
				name: 'Content',
				// Deliberately not "this message probably held an attachment", which is what legacy guessed here.
				// The count below says whether it did, so the empty case can state the plain fact instead.
				value: quoteContent(input.content, '*No text content*'),
			},
		],
	};

	if (input.attachmentCount > 0) {
		embed.fields!.push({
			name: 'Attachments',
			// Only the count: the files themselves are already gone from Discord's CDN by the time this posts,
			// so a link would be a dead one and re-uploading somebody's deleted media is not this bot's job.
			value: `${input.attachmentCount} attachment${input.attachmentCount === 1 ? '' : 's'}, no longer retrievable`,
			inline: true,
		});
	}

	if (input.moderator) {
		embed.footer = { text: `Deleted by ${input.moderator.tag} (${input.moderator.id})` };
	}

	return embed;
}

export interface MessageEditLogInput {
	readonly after: string;
	readonly author: LogActor;
	readonly before: string;
	readonly channelId: string;
	readonly guildId: string;
	readonly messageId: string;
}

export function buildMessageEditEmbed(input: MessageEditLogInput): APIEmbed {
	const posted = snowflakeTimestampSeconds(input.messageId);
	const link = `https://discord.com/channels/${input.guildId}/${input.channelId}/${input.messageId}`;

	return {
		color: EDIT_COLOR,
		author: authorLine(input.author),
		description: `[Message](${link}) edited, posted <t:${posted}:R> in <#${input.channelId}>`,
		fields: [
			{ name: 'Before', value: quoteContent(input.before, '*No text content*') },
			{ name: 'After', value: quoteContent(input.after, '*No text content*') },
		],
	};
}

/**
 * Which part of somebody's identity changed. `nickname` is per-guild; the other two are global and simply
 * observed here because a guild's own log is where staff look for "who was this account yesterday".
 */
export type ProfileChangeKind = 'display name' | 'nickname' | 'username';

export interface ProfileChangeLogInput {
	readonly after: string | null;
	readonly before: string | null;
	readonly kind: ProfileChangeKind;
	readonly user: LogActor;
}

export function buildProfileChangeEmbed(input: ProfileChangeLogInput): APIEmbed {
	return {
		color: PROFILE_COLOR,
		author: authorLine(input.user),
		title: `Changed their ${input.kind}`,
		fields: [
			// `*none*` rather than an empty string for the same reason the message builders have an empty
			// branch: clearing a nickname is the single most common change logged here, and an empty field
			// value is a 400.
			{ name: 'Before', value: input.before === null ? '*none*' : truncate(input.before, FIELD_VALUE_LIMIT), inline: true },
			{ name: 'After', value: input.after === null ? '*none*' : truncate(input.after, FIELD_VALUE_LIMIT), inline: true },
		],
	};
}
