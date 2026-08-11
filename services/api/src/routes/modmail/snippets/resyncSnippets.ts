import { getContext } from '@chatsift/backend-core';
import type { Snippets } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { resyncGuildCommands } from '../../../util/commandResync.js';
import { apiForGuild } from '../../../util/discordAPI.js';
import { getBotApplicationId } from '../../../util/discordApplication.js';
import type { ResyncFailure } from '../../../util/resync.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { buildSnippetCommandBody } from '../discordBodies.js';

const bodySchema = z.strictObject({});
const paramsSchema = z.object({ guildId: snowflakeSchema });

export interface ResyncSnippetsResult {
	/**
	 * Per-item failures that didn't stop the rest of the resync -- see `util/commandResync.ts`. Empty on a
	 * fully clean run.
	 */
	failures: ResyncFailure[];
	snippetsRecreated: number;
	staleCommandsDeleted: number;
}

/**
 * See docs/roadmap/01-architecture.md §8. A guild swapping which application owns it (public to/from a custom
 * instance, or between two custom instances) orphans everything Discord scopes to an application id -- a
 * snippet's guild command belongs to whoever created it, not to the guild, so the newly-owning application
 * doesn't just "see" it. This route reconciles the guild's snippet commands against whichever application
 * currently owns `guildId` (`apiForGuild`/`getBotApplicationId`, registry-driven); `panels/resyncPanels.ts`
 * does the same for panel messages, and `social/interactions/resyncInteractions.ts` shares this one's
 * machinery (`util/commandResync.ts`) for the identical problem on Social's side.
 *
 * Deliberately not run automatically on a swap (decision 10) -- ownership can flap (a row edited twice in
 * quick succession, a bad deploy rolled back) and reissuing every guild command on every registry refresh
 * would be wasteful. An explicit button run once after a deliberate swap is simpler to reason about.
 */
export default defineRoute({
	method: 'post',
	path: '/v3/guilds/:guildId/modmail/snippets/resync',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<ResyncSnippetsResult> {
		const { guildId } = req.params;
		const db = getContext().db;

		const snippets = await db<Snippets[]>`SELECT * FROM snippets WHERE guild_id = ${guildId}`;

		const { failures, recreated, staleCommandsDeleted } = await resyncGuildCommands({
			api: apiForGuild('MODMAIL', guildId),
			applicationId: await getBotApplicationId('MODMAIL', guildId),
			guildId,
			items: snippets,
			logger: req.logger,
			adapter: {
				// NOT NULL in the schema, so a snippet always has an id to check -- unlike a social interaction,
				// which can legitimately have none yet, and correspondingly nothing to clear before minting a
				// replacement (no `clearCommandIds` here).
				commandId: (snippet) => snippet.commandId,
				describe: (snippet) => `snippet "${snippet.name}"`,
				buildBody: (snippet) => buildSnippetCommandBody(snippet.name),
				async persistCommandId(snippet, commandId) {
					await db`UPDATE snippets SET command_id = ${commandId} WHERE id = ${snippet.id}`;
				},
			},
		});

		return { failures, snippetsRecreated: recreated, staleCommandsDeleted };
	},
});
