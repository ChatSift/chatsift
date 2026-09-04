import { displayAvatarURL, snowflakeTimestampSeconds } from '@chatsift/core';
import type { APIEmbed } from '@discordjs/core';

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
	return { name: `${actor.tag} (${actor.id})`, icon_url: displayAvatarURL(actor.id, actor.avatar) };
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
		// The same avatar treatment every other actor named on a log embed gets since #392. `messageObserver.ts`
		// has already resolved this account for the tag, so the icon costs nothing, and `displayAvatarURL` falls
		// back to the default avatar for the one it could not resolve.
		embed.footer = {
			text: `Deleted by ${input.moderator.tag} (${input.moderator.id})`,
			icon_url: displayAvatarURL(input.moderator.id, input.moderator.avatar),
		};
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

/**
 * What the filter did about a hit, in the guild's words. A closed set because the log is a permanent record
 * moderators read months later, and free-text outcomes drift into being unreadable.
 */
export interface FilterOutcome {
	/**
	 * The case this produced, if it produced one, already rendered by `formatCaseRef` -- `#12`, hyperlinked to
	 * its own mod-log message when there is one (#381). Formatted by the caller because that link points at the
	 * mod log while this embed is posted to the filter log, two different webhooks.
	 */
	readonly caseRef?: string;
	/**
	 * One line saying what happened -- "Banned", "No policy configured", "Skipped: bypass role".
	 */
	readonly summary: string;
}

export interface FilterHitLogInput {
	readonly author: LogActor;
	readonly channelId: string | null;
	/**
	 * The offending text. For a native AutoMod hit this is `matched_content` when Discord sends it, falling
	 * back to the whole message -- the first is the substring that tripped the rule, which is what a moderator
	 * actually wants to see.
	 */
	readonly content: string | null;
	/**
	 * The rule entry that matched, or null when Discord did not name one (a preset rule's word list, which is
	 * not enumerable, or a trigger that carries no keyword).
	 */
	readonly matched: string | null;
	readonly outcome: FilterOutcome;
	/**
	 * What caught it, named the way the guild configured it -- an AutoMod rule's name, falling back to its id
	 * when the bot cannot read the rule list (see `automodRules.ts`).
	 */
	readonly source: string;
}

const FILTER_COLOR = 0xef_44_44;

/**
 * The filter log embed (P5, feature 33). One shape for every filter, which is the reshape feature 33 is: legacy
 * rendered native hits nowhere and its own runners' hits in a per-runner format, so staff read two places and
 * got no help correlating them.
 *
 * Posted for **every** hit, including the ones no policy responded to -- a rule quietly catching ten times what
 * its owner expected is the thing this log exists to make visible, and it is invisible if only punishments are
 * logged.
 */
export function buildFilterHitEmbed(input: FilterHitLogInput): APIEmbed {
	const fields: NonNullable<APIEmbed['fields']> = [
		{ name: 'Filter', value: input.source, inline: true },
		{
			name: 'Outcome',
			value:
				input.outcome.caseRef === undefined
					? input.outcome.summary
					: `${input.outcome.summary} (case ${input.outcome.caseRef})`,
			inline: true,
		},
	];

	if (input.matched !== null) {
		// Inline code rather than a blockquote: this is one entry from a configured list, not a member's prose,
		// and backticks stop a word containing markdown from reformatting the field.
		fields.push({ name: 'Matched', value: `\`${truncate(input.matched, FIELD_VALUE_LIMIT - 2)}\`` });
	}

	fields.push({ name: 'Content', value: quoteContent(input.content ?? '', '*Not available*') });

	return {
		color: FILTER_COLOR,
		author: authorLine(input.author),
		description:
			input.channelId === null
				? 'Filter triggered'
				: `Filter triggered in <#${input.channelId}>`,
		fields,
	};
}
