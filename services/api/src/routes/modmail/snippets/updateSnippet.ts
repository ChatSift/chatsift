import { getContext } from '@chatsift/backend-core';
import { isUniqueViolation } from '@chatsift/db';
import type { Snippets, SnippetsId } from '@chatsift/db';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { badData, conflict, notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { apiForGuild } from '../../../util/discordAPI.js';
import { getBotApplicationId } from '../../../util/discordApplication.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { buildSnippetCommandBody } from '../discordBodies.js';
import { updateSnippetBodySchema } from '../schemas.js';

const bodySchema = updateSnippetBodySchema;
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	snippetId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as SnippetsId),
});

export type UpdateSnippetBody = z.input<typeof bodySchema>;
export type UpdateSnippetResult = Snippets;

export default defineRoute({
	method: 'patch',
	path: '/v3/guilds/:guildId/modmail/snippets/:snippetId',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<UpdateSnippetResult> {
		const data = req.body;
		const { guildId, snippetId } = req.params;
		const db = getContext().db;

		const [existing] = await db<Snippets[]>`
			SELECT * FROM snippets WHERE id = ${snippetId} AND guild_id = ${guildId}
		`;

		if (!existing) {
			throw notFound('snippet not found');
		}

		// Renamed here, outside the DB transaction/lock below -- holding a row lock (and a pooled connection) for
		// the duration of an external Discord HTTP call risks starving the connection pool if Discord is slow or
		// degraded, turning a Discord-side problem into a wider outage.
		//
		// Compared against Discord's *live* command name, not `existing.name` (the DB's cached copy) -- if a
		// previous edit renamed the Discord command but then failed to commit the DB write (a race, a dropped
		// connection, whatever), `existing.name` stays stuck on the old value forever, and the dashboard's name
		// field -- always populated from that same stale DB row -- would keep resubmitting it right back. Diffing
		// against `existing.name` would then see no change and skip the rename on every future edit, even ones
		// that don't touch the name, permanently baking in the drift. Reading Discord's actual current name
		// instead means *any* edit reconciles the two, not just one that happens to type a new name.
		let commandId = existing.commandId;
		// Set only when a replacement command was minted below, so the transaction's failure path can delete it
		// again -- see the catch at the bottom.
		let deleteRecreatedCommand: (() => Promise<void>) | null = null;

		if (data.name !== undefined) {
			const applicationId = await getBotApplicationId('MODMAIL', guildId);
			const api = apiForGuild('MODMAIL', guildId);

			let liveName: string | null;
			try {
				liveName = (await api.applicationCommands.getGuildCommand(applicationId, guildId, existing.commandId)).name;
			} catch (error) {
				if (!(error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownApplicationCommand)) {
					throw error;
				}

				// #369: the stored id resolves under no application that currently owns this guild -- the command
				// was deleted out of band, or the guild moved on/off a custom instance. This used to escape as a
				// 500 and left the snippet permanently uneditable. Re-registering inline rather than deferring to
				// `resyncSnippets.ts` (the way social's `updateInteraction.ts` does): `snippets.command_id` is
				// NOT NULL and the bot dispatches snippets by command id alone (`findSnippetByCommandId`), so
				// there's no id to null out and no name-based fallback to degrade to -- and the resync card is
				// hidden for a guild that isn't on a custom instance, so an ordinary guild couldn't reach it.
				liveName = null;
			}

			try {
				if (liveName === null) {
					const command = await api.applicationCommands.createGuildCommand(
						applicationId,
						guildId,
						buildSnippetCommandBody(data.name),
					);

					commandId = command.id;
					deleteRecreatedCommand = async () =>
						api.applicationCommands.deleteGuildCommand(applicationId, guildId, command.id);
				} else if (liveName !== data.name) {
					await api.applicationCommands.editGuildCommand(applicationId, guildId, existing.commandId, {
						name: data.name,
					});
				}
			} catch (error) {
				if (error instanceof DiscordAPIError && error.status === 400) {
					throw badData('not a valid Discord command name');
				}

				throw error;
			}
		}

		try {
			return await db.begin(async (sql) => {
				const [current] = await sql<Snippets[]>`
					SELECT * FROM snippets WHERE id = ${snippetId} AND guild_id = ${guildId} FOR UPDATE
				`;

				if (!current) {
					throw notFound('snippet not found');
				}

				const name = data.name ?? current.name;
				const content = data.content ?? current.content;
				// `data.attachmentUrl`/`data.attachmentFilename` are `.nullable().optional()` -- `undefined` (the
				// key was omitted) means "leave unchanged", while an explicit `null` means "clear it", so these
				// can't use the plain `?? current.x` fallback the other fields above use (that would treat an
				// explicit `null` the same as "unchanged" and silently ignore the clear).
				const attachmentUrl = data.attachmentUrl === undefined ? current.attachmentUrl : data.attachmentUrl;
				// The schema only rejects clearing the URL and setting a filename in the *same* request --
				// it can't see that e.g. the URL was already null before this request and this one only sets a
				// filename. Force the invariant here instead of erroring, since the DB also enforces it via a
				// CHECK constraint (`snippets_attachment_filename_requires_url_check`) that this would otherwise trip.
				const attachmentFilename = attachmentUrl
					? data.attachmentFilename === undefined
						? current.attachmentFilename
						: data.attachmentFilename
					: null;

				// Archive on a change to *any* editable field, not just content (#324) -- a rename or an
				// attachment swap used to leave no trace at all, so the history the dashboard now renders would
				// have silently misrepresented what actually happened to the snippet. Compared against the
				// resolved next-values rather than `data`, so a request that submits every field unchanged (the
				// dashboard's edit form always does -- it PATCHes the whole form) doesn't record an empty
				// revision. The row snapshots `current` in full; see `getSnippetUpdates.ts` for why the
				// per-revision diff is derived from consecutive snapshots instead of stored alongside them.
				const isChanged =
					name !== current.name ||
					content !== current.content ||
					attachmentUrl !== current.attachmentUrl ||
					attachmentFilename !== current.attachmentFilename;

				if (isChanged) {
					await sql`
						INSERT INTO snippet_updates (
							snippet_id, updated_by, old_content, old_name, old_attachment_url, old_attachment_filename
						)
						VALUES (
							${snippetId},
							${req.tokens!.access.sub},
							${current.content},
							${current.name},
							${current.attachmentUrl},
							${current.attachmentFilename}
						)
					`;
				}

				const [updated] = await sql<Snippets[]>`
					UPDATE snippets
					SET
						command_id = ${commandId},
						name = ${name},
						content = ${content},
						attachment_url = ${attachmentUrl},
						attachment_filename = ${attachmentFilename},
						last_updated_at = now()
					WHERE id = ${snippetId}
					RETURNING *
				`;

				return updated!;
			});
		} catch (error) {
			// The row still points at the old, dead id, so a replacement minted above now backs nothing and
			// would answer `/name` with bot-core's "no handler found". Fire-and-forget, exactly as
			// `createSnippet.ts` cleans up after its own failed insert.
			if (deleteRecreatedCommand) {
				const cleanup = deleteRecreatedCommand;
				void (async () => {
					try {
						await cleanup();
					} catch (cleanupError) {
						req.logger.error({ err: cleanupError }, 'failed to clean up orphaned snippet command');
					}
				})();
			}

			if (isUniqueViolation(error, 'snippets_guild_id_name_key')) {
				throw conflict('a snippet with this name already exists');
			}

			throw error;
		}
	},
});
