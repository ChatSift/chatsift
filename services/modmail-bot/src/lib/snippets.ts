import { URL } from 'node:url';
import { getContext } from '@chatsift/backend-core';
import type { Snippets } from '@chatsift/db';
import type { RelayAttachmentLike } from './media.js';

/**
 * Each snippet is its own per-guild slash command, minted directly against Discord by the API on
 * create (`services/api/src/routes/modmail/snippets/createSnippet.ts`) — there's no static
 * `CommandHandler` for these, so they're looked up here by the invoked command's id
 * (`interaction.data.id`) rather than dispatched through `@chatsift/bot-core`'s static command map.
 * See `registerUnknownCommandResolver` in `index.ts`.
 */
export async function findSnippetByCommandId(guildId: string, commandId: string): Promise<Snippets | undefined> {
	const [snippet] = await getContext().db<Snippets[]>`
		SELECT * FROM snippets WHERE guild_id = ${guildId} AND command_id = ${commandId}
	`;

	return snippet;
}

export async function recordSnippetUsage(snippetId: Snippets['id']): Promise<void> {
	await getContext().db`
		UPDATE snippets SET times_used = times_used + 1, last_used_at = now() WHERE id = ${snippetId}
	`;
}

/**
 * Falls back to the URL's last path segment for a display name -- staff aren't required to set
 * `attachmentFilename` when pasting a link, but Discord still needs *some* filename for the re-uploaded
 * file (see `buildRelayMedia`).
 */
function deriveFilenameFromUrl(url: string): string {
	try {
		const { pathname } = new URL(url);
		const segments = pathname.split('/').filter((segment) => segment.length > 0);
		return segments.at(-1) ?? 'attachment';
	} catch {
		return 'attachment';
	}
}

/**
 * A snippet's attachment is a staff-pasted URL, not a Discord-verified `APIAttachment` -- unlike every
 * other `RelayAttachmentLike` source in this bot, there's no trustworthy `size` available ahead of the
 * actual fetch. `size: 0` always clears `buildRelayMedia`'s pre-fetch size guard; the real size is
 * enforced by its post-fetch check instead (added specifically to cover this caller).
 */
export function attachmentsForSnippet(snippet: Snippets): RelayAttachmentLike[] {
	if (!snippet.attachmentUrl) {
		return [];
	}

	return [
		{
			filename: snippet.attachmentFilename ?? deriveFilenameFromUrl(snippet.attachmentUrl),
			size: 0,
			url: snippet.attachmentUrl,
		},
	];
}
