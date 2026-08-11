import { getContext } from '@chatsift/backend-core';
import type { SocialInteractions } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { resyncGuildCommands } from '../../../util/commandResync.js';
import { apiForGuild } from '../../../util/discordAPI.js';
import { getBotApplicationId } from '../../../util/discordApplication.js';
import type { ResyncFailure } from '../../../util/resync.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { buildInteractionCommandBody } from '../discordBodies.js';

const bodySchema = z.strictObject({});
const paramsSchema = z.object({ guildId: snowflakeSchema });

export interface ResyncSocialInteractionsResult {
	/**
	 * Per-item failures that didn't stop the rest of the resync -- see `util/commandResync.ts`. Empty on a
	 * fully clean run.
	 */
	failures: ResyncFailure[];
	interactionsRecreated: number;
	staleCommandsDeleted: number;
}

/**
 * Reconciles a guild's interaction commands against its `social_interactions` rows, sharing ModMail's
 * machinery (`util/commandResync.ts`) since it's the same problem: a command id belongs to the *application*
 * that minted it, so anything that changes which application owns a guild orphans every id stored for it --
 * moving a guild between the production Social deployment and a canary, or the legacy-to-new-application
 * cutover, where every migrated row lands with `command_id IS NULL` by construction (redesign ledger item 3,
 * docs/roadmap/10-social-port.md). Out-of-band deletions and half-written mutations land here too.
 *
 * Same "explicit button, never automatic" stance as `modmail/snippets/resyncSnippets.ts` -- see its doc
 * comment.
 */
export default defineRoute({
	method: 'post',
	path: '/v3/guilds/:guildId/social/interactions/resync',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<ResyncSocialInteractionsResult> {
		const { guildId } = req.params;
		const db = getContext().db;

		const interactions = await db<SocialInteractions[]>`
			SELECT * FROM social_interactions WHERE guild_id = ${guildId}
		`;

		const { failures, recreated, staleCommandsDeleted } = await resyncGuildCommands({
			api: apiForGuild('SOCIAL', guildId),
			applicationId: await getBotApplicationId('SOCIAL', guildId),
			guildId,
			items: interactions,
			logger: req.logger,
			adapter: {
				// Nullable here, unlike a snippet's: `null` is the normal post-migration state and means "never
				// registered under any application we own", which skips straight to registration.
				commandId: (interaction) => interaction.commandId,
				describe: (interaction) => `interaction "${interaction.name}"`,
				buildBody: (interaction) => buildInteractionCommandBody(interaction.name, interaction.allowTargets),
				// Required by the UNIQUE `(guild_id, command_id)` index -- see `CommandResyncAdapter`'s own doc
				// comment for the rename-shuffle case that would otherwise collide part-way through a run.
				async clearCommandIds(items) {
					await db`
						UPDATE social_interactions SET command_id = NULL
						WHERE guild_id = ${guildId} AND id = ANY(${items.map((interaction) => interaction.id)})
					`;
				},
				async persistCommandId(interaction, commandId) {
					await db`UPDATE social_interactions SET command_id = ${commandId} WHERE id = ${interaction.id}`;
				},
			},
		});

		return { failures, interactionsRecreated: recreated, staleCommandsDeleted };
	},
});
