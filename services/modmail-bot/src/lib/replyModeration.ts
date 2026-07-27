import type { APIEmbed, APIEmbedFooter, APIEmbedImage } from '@discordjs/core';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';

/**
 * Only 404 / Unknown Message means "actually gone" -- anything else (missing permissions, rate limits,
 * transport errors) should surface as a real failure rather than being treated as a deleted reply.
 * Mirrors `services/ama-bot/src/components/amaRepostSelect.ts`'s use of this same check; shared here
 * between `/edit` and `/delete` rather than duplicated per-command.
 */
export function isUnknownMessageError(error: unknown): boolean {
	return error instanceof DiscordAPIError && (error.status === 404 || error.code === RESTJSONErrorCodes.UnknownMessage);
}

/**
 * Discord's own "danger" red -- distinct from `relay.ts`'s `GREEN`/`BLURPLE`, so a deleted reply's log
 * embed reads as visually different at a glance rather than just a text note buried in the description.
 * Doubles as the "already deleted" check below: `thread_messages` has no `deleted_at` column, so the
 * embed's own color is the only persisted signal `/delete`/`/edit` have to detect a prior deletion.
 */
export const DELETED_COLOR = 0xed4245;

export function isMarkedDeleted(embed: APIEmbed): boolean {
	return embed.color === DELETED_COLOR;
}

/**
 * Mutates a fetched log embed to obviously show a reply was deleted -- struck-through description, a
 * "Deleted by" note, and `DELETED_COLOR` -- while leaving the message itself in place as an audit trace
 * (the `/delete` command only actually deletes the user-facing copy). Idempotency is the caller's
 * responsibility (`isMarkedDeleted` should be checked first); calling this twice would double the note.
 */
export function markEmbedDeleted(embed: APIEmbed, deletedById: string): APIEmbed {
	const image = resolveEditedImage(embed.image);
	return {
		...embed,
		color: DELETED_COLOR,
		...(image ? { image } : {}),
		description: [embed.description ? `~~${embed.description}~~` : undefined, `🗑️ Deleted by <@${deletedById}>`]
			.filter(Boolean)
			.join('\n\n'),
	};
}

const EDITED_SUFFIX = ' • edited';

/**
 * Appends an "edited" marker to a fetched embed's footer text, idempotently (checked by suffix rather
 * than a DB flag, for the same "no `thread_messages` column for this" reason as `DELETED_COLOR` above)
 * so re-editing the same reply doesn't stack the marker.
 */
export function markFooterEdited(footer: APIEmbedFooter): APIEmbedFooter {
	return footer.text.endsWith(EDITED_SUFFIX) ? footer : { ...footer, text: footer.text + EDITED_SUFFIX };
}

/**
 * Matches a Discord CDN attachment url (`cdn.discordapp.com`/`media.discordapp.net`), capturing the
 * filename -- the one piece `attachment://<filename>` needs (see `resolveEditedImage` below).
 */
const DISCORD_ATTACHMENT_URL_PATTERN =
	/^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\/\d+\/\d+\/(?<filename>[^/?]+)/;

/**
 * Rewrites an embed image's url from the *resolved* form `getMessage` always hands back into the
 * `attachment://<filename>` token form instead, before it's resent on an edit. Verified empirically
 * (manual `PATCH` calls against the live API, bypassing discord.js entirely) that resending the resolved
 * CDN url as-is on an edit makes Discord silently copy that url into the message's own `attachments`
 * array while *also* still rendering the embed's image -- i.e. the image shows twice, once merged in
 * the embed and once as its own separate block. Resending it as `attachment://<filename>` instead avoids
 * that entirely: Discord resolves it back to the correct working image with no separate attachment
 * entry, confirmed on both an already-duplicated message (recovers) and a never-before-edited one (never
 * duplicates in the first place). This works regardless of whether the image genuinely belongs to this
 * message or was only ever a fixed external reference (e.g. a snippet's stored attachment url, which
 * points at a completely different message) -- Discord resolves the token by filename either way.
 * Left untouched for anything that isn't a Discord CDN attachment url in the first place.
 */
export function resolveEditedImage(image: APIEmbedImage | undefined): APIEmbedImage | undefined {
	if (!image) {
		return undefined;
	}

	const match = DISCORD_ATTACHMENT_URL_PATTERN.exec(image.url);
	if (!match) {
		return image;
	}

	return { url: `attachment://${decodeURIComponent(match.groups!['filename']!)}` };
}
