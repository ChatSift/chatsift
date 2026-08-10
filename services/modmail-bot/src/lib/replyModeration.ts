import { resolveEditedImage } from '@chatsift/core';
import type { APIEmbed, APIEmbedFooter } from '@discordjs/core';
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
 * Discord's yellow -- used only for the standalone "message edited" notification the
 * `MessageUpdate` relay handler posts alongside its edit, distinct from both the log embed's own
 * (untouched) color and `DELETED_COLOR` above so the three states stay visually distinguishable.
 */
export const EDITED_COLOR = 0xfee75c;

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
 * Replaces an existing embed's text with newly-edited content, leaving `color`/`author` untouched.
 * `image` is re-derived via `resolveEditedImage` rather than carried over verbatim -- see its doc
 * comment for why resending the resolved CDN url as-is duplicates the image. Edit is deliberately
 * text-only otherwise: `thread_messages` stores no content or media metadata beyond the two Discord
 * message ids, so there's nothing to reconstruct an attachment/media note from -- whatever the embed
 * already has there is carried forward as-is. Shared between `/edit` (staff replies) and the
 * `MessageUpdate` relay handler (a user editing their own message).
 *
 * `markEdited` is only ever `true` for the mod-forum log copy -- the "edited" marker is internal
 * bookkeeping for staff, same as the `Reply ID:` prefix itself (`relay.ts`), and shouldn't leak onto
 * the copy the user who opened the ticket actually sees.
 */
export function buildEditedEmbed(embed: APIEmbed, content: string, markEdited: boolean): APIEmbed {
	const image = resolveEditedImage(embed.image);
	return {
		...embed,
		description: content,
		...(image ? { image } : {}),
		...(markEdited && embed.footer ? { footer: markFooterEdited(embed.footer) } : {}),
	};
}
