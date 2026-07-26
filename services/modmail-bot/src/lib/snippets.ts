import { getContext } from '@chatsift/backend-core';
import type { Snippets } from '@chatsift/db';

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
