import { getContext } from '@chatsift/backend-core';
import type { Snippets } from '@chatsift/db';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { apiForGuild } from '../../../util/discordAPI.js';
import { getModmailApplicationId } from '../../../util/discordApplication.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { buildSnippetCommandBody } from '../discordBodies.js';
import type { ResyncFailure } from '../resyncShared.js';
import { describeError } from '../resyncShared.js';

const bodySchema = z.strictObject({});
const paramsSchema = z.object({ guildId: snowflakeSchema });

export interface ResyncSnippetsResult {
	/**
	 * Per-item failures that didn't stop the rest of the resync -- one bad snippet or command (a transient
	 * Discord error, a DB write that failed after a Discord call already succeeded) shouldn't block reconciling
	 * everything else for the guild. Empty on a fully clean run.
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
 * currently owns `guildId` (`apiForGuild`/`getModmailApplicationId`, registry-driven);
 * `panels/resyncPanels.ts` does the same for panel messages.
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
		const api = apiForGuild('MODMAIL', guildId);
		const applicationId = await getModmailApplicationId(guildId);

		// A command id is only ever valid under the application that created it, so checking whether it still
		// resolves under the *current* owner is exactly the "does this predate the last swap" test -- no need
		// to track which application used to own the guild at all.
		const snippets = await db<Snippets[]>`SELECT * FROM snippets WHERE guild_id = ${guildId}`;

		let snippetsRecreated = 0;
		const liveCommandIds = new Set<string>();
		const failures: ResyncFailure[] = [];

		// Each snippet is handled in isolation -- one Discord hiccup or a DB write that fails after its
		// Discord call already succeeded shouldn't stop every other snippet in the guild from being resynced.
		for (const snippet of snippets) {
			try {
				let stillValid = true;
				try {
					await api.applicationCommands.getGuildCommand(applicationId, guildId, snippet.commandId);
				} catch (error) {
					if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownApplicationCommand) {
						stillValid = false;
					} else {
						// Inconclusive, not confirmed-stale -- a transient failure checking the command (rate limit,
						// network blip) tells us nothing about whether it's actually gone. Keep it in `liveCommandIds`
						// so the stale-cleanup pass below doesn't delete a command that may well still be fine just
						// because this one check failed, then surface the failure below instead of guessing.
						liveCommandIds.add(snippet.commandId);
						throw error;
					}
				}

				if (stillValid) {
					liveCommandIds.add(snippet.commandId);
					continue;
				}

				const command = await api.applicationCommands.createGuildCommand(
					applicationId,
					guildId,
					buildSnippetCommandBody(snippet.name),
				);

				try {
					await db`UPDATE snippets SET command_id = ${command.id} WHERE id = ${snippet.id}`;
				} catch (dbError) {
					// The command is live on Discord but the DB still points at the old, dead one -- not added to
					// `liveCommandIds`, so the stale-cleanup pass below will delete this brand-new command as an
					// unrecognized orphan (self-healing, if wasteful), and the next resync run will just recreate
					// it again. Logged with the orphaned command's id so it can be found by hand if needed sooner.
					req.logger.error(
						{ err: dbError, guildId, snippetId: snippet.id, commandId: command.id },
						'created a replacement snippet command but failed to persist its id',
					);
					failures.push({
						item: `snippet "${snippet.name}"`,
						error: `created replacement command ${command.id} but failed to save it: ${describeError(dbError)}`,
					});
					continue;
				}

				liveCommandIds.add(command.id);
				snippetsRecreated++;
			} catch (error) {
				req.logger.error(
					{ err: error, guildId, snippetId: snippet.id, snippetName: snippet.name },
					'failed to resync snippet command',
				);
				failures.push({ item: `snippet "${snippet.name}"`, error: describeError(error) });
			}
		}

		// Anything registered under the current application that isn't one of the guild's live snippets is
		// an orphan -- either a leftover from a snippet since deleted, or (on a swap back to an application
		// this guild used before) a leftover from that earlier stint. This pass has to stay with the snippet
		// pass above rather than moving anywhere else: `liveCommandIds` is what makes it safe.
		const existingCommands = await api.applicationCommands.getGuildCommands(applicationId, guildId);
		let staleCommandsDeleted = 0;

		for (const command of existingCommands) {
			if (liveCommandIds.has(command.id)) {
				continue;
			}

			try {
				await api.applicationCommands.deleteGuildCommand(applicationId, guildId, command.id);
				staleCommandsDeleted++;
			} catch (error) {
				req.logger.error(
					{ err: error, guildId, commandId: command.id, commandName: command.name },
					'failed to delete stale snippet command',
				);
				failures.push({ item: `command "${command.name}"`, error: describeError(error) });
			}
		}

		return { failures, snippetsRecreated, staleCommandsDeleted };
	},
});
