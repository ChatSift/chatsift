import { getContext } from '@chatsift/backend-core';
import type { Snippets, TicketPanels } from '@chatsift/db';
import type {
	APIButtonComponentWithCustomId,
	RESTPostAPIApplicationGuildCommandsJSONBody,
	RESTPostAPIChannelMessageJSONBody,
} from '@discordjs/core';
import { ApplicationCommandOptionType, ButtonStyle, ComponentType, RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { apiForGuild } from '../../util/discordAPI.js';
import { getModmailApplicationId } from '../../util/discordApplication.js';
import { snowflakeSchema } from '../../util/schemas.js';

const bodySchema = z.strictObject({});
const paramsSchema = z.object({ guildId: snowflakeSchema });

export interface ResyncFailure {
	error: string;
	/**
	 * Human-readable identifier for whichever snippet/command/panel this failure is about -- there's no single
	 * shared id space across the three kinds of item this route touches, so this is just enough to find it
	 * (name for a snippet/command, numeric id for a panel) rather than a structured reference.
	 */
	item: string;
}

export interface ResyncModmailResult {
	/**
	 * Per-item failures that didn't stop the rest of the resync -- one bad snippet/command/panel (a transient
	 * Discord error, a DB write that failed after a Discord call already succeeded) shouldn't block reconciling
	 * everything else for the guild. Empty on a fully clean run.
	 */
	failures: ResyncFailure[];
	panelsReposted: number;
	snippetsRecreated: number;
	staleCommandsDeleted: number;
}

/**
 * See docs/roadmap/01-architecture.md §8. A guild swapping which application owns it (public to/from
 * a custom instance, or between two custom instances) orphans everything Discord scopes to an application id --
 * a snippet's guild command and a panel's message both belong to whoever created them, not to the guild, so
 * the newly-owning application doesn't just "see" them. This route reconciles both against whichever
 * application currently owns `guildId` (`apiForGuild`/`getModmailApplicationId`, registry-driven).
 *
 * Deliberately not run automatically on a swap (decision 10) -- ownership can flap (a row edited twice in
 * quick succession, a bad deploy rolled back) and reissuing every guild command / reposting every panel on
 * every registry refresh would be wasteful and, worse, would repost panels that never needed it. An explicit
 * button run once after a deliberate swap is simpler to reason about.
 */
export default defineRoute({
	method: 'post',
	path: '/v3/guilds/:guildId/modmail/resync',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<ResyncModmailResult> {
		const { guildId } = req.params;
		const db = getContext().db;
		const api = apiForGuild('MODMAIL', guildId);
		const applicationId = await getModmailApplicationId(guildId);

		// Snippets: a command id is only ever valid under the application that created it, so checking
		// whether it still resolves under the *current* owner is exactly the "does this predate the last
		// swap" test -- no need to track which application used to own the guild at all.
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

				const commandBody: RESTPostAPIApplicationGuildCommandsJSONBody = {
					name: snippet.name,
					description: 'ModMail snippet',
					default_member_permissions: '0',
					options: [
						{
							name: 'anon',
							description: 'Whether to send the reply anonymously - defaults to false',
							type: ApplicationCommandOptionType.Boolean,
						},
					],
				};

				const command = await api.applicationCommands.createGuildCommand(applicationId, guildId, commandBody);

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
						error: `created replacement command ${command.id} but failed to save it: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
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
				failures.push({
					item: `snippet "${snippet.name}"`,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		// Anything registered under the current application that isn't one of the guild's live snippets is
		// an orphan -- either a leftover from a snippet since deleted, or (on a swap back to an application
		// this guild used before) a leftover from that earlier stint.
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
				failures.push({
					item: `command "${command.name}"`,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		// Panels: a message belongs to whichever application posted it. Editing it under a *different*
		// application fails with `CannotEditMessageAuthoredByAnotherUser` (or `UnknownMessage` if it's gone
		// entirely) -- exactly the "this panel predates the current owner" signal, and a successful edit
		// means it already belongs here, nothing to do.
		const panels = await db<TicketPanels[]>`SELECT * FROM ticket_panels WHERE guild_id = ${guildId}`;
		let panelsReposted = 0;

		// Same isolation as the snippet loop above -- one panel's Discord/DB failure shouldn't block reposting
		// every other panel in the guild.
		for (const panel of panels) {
			try {
				const messageBodyBase = JSON.parse(panel.panelJsonData) as RESTPostAPIChannelMessageJSONBody;

				// The button's label lives only on the live Discord message, not in `panel_json_data` (see
				// createPanel.ts) -- read it back off the current message before we potentially lose access to
				// it, falling back to the default if the message is gone entirely rather than just foreign-owned.
				let buttonLabel = 'Create Ticket';
				try {
					const existingMessage = await api.channels.getMessage(panel.channelId, panel.messageId);
					const existingRow = existingMessage.components?.[0];
					const existingButton =
						existingRow?.type === ComponentType.ActionRow
							? (existingRow.components[0] as APIButtonComponentWithCustomId | undefined)
							: undefined;
					if (existingButton?.label) {
						buttonLabel = existingButton.label;
					}
				} catch {
					// Message is gone entirely -- fall back to the default label above.
				}

				const components: RESTPostAPIChannelMessageJSONBody['components'] = [
					{
						type: ComponentType.ActionRow,
						components: [
							{
								type: ComponentType.Button,
								style: ButtonStyle.Primary,
								label: buttonLabel,
								custom_id: 'modmail-create-ticket',
							},
						],
					},
				];

				let needsRepost = false;
				try {
					await api.channels.editMessage(panel.channelId, panel.messageId, { ...messageBodyBase, components });
				} catch (error) {
					if (
						error instanceof DiscordAPIError &&
						(error.code === RESTJSONErrorCodes.CannotEditMessageAuthoredByAnotherUser ||
							error.code === RESTJSONErrorCodes.UnknownMessage)
					) {
						needsRepost = true;
					} else {
						throw error;
					}
				}

				if (!needsRepost) {
					continue;
				}

				const oldMessageId = panel.messageId;
				const newMessage = await api.channels.createMessage(panel.channelId, { ...messageBodyBase, components });

				try {
					await db`UPDATE ticket_panels SET message_id = ${newMessage.id} WHERE id = ${panel.id}`;
				} catch (dbError) {
					// The new message is live on Discord but `ticket_panels` still points at the old one -- do NOT
					// delete the old message below in this case, since that would leave the panel with no working
					// message at all instead of just a stale one. Logged with the new message's id so it can be
					// reconciled by hand (or picked up cleanly by another resync run) sooner rather than later.
					req.logger.error(
						{
							err: dbError,
							guildId,
							panelId: panel.id,
							channelId: panel.channelId,
							newMessageId: newMessage.id,
							oldMessageId,
						},
						'reposted a panel message but failed to persist its new message id',
					);
					failures.push({
						item: `panel ${panel.id}`,
						error: `reposted message ${newMessage.id} but failed to save it: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
					});
					continue;
				}

				panelsReposted++;

				// Best-effort: the current application may hold Manage Messages in the channel even though it
				// isn't the message's author, in which case this actually cleans up the leftover. If not, the
				// old message just sits there with a button that answers "this server is served by <label>"
				// (P1's ownership filter) until someone deletes it by hand -- not a correctness problem either way.
				void (async () => {
					try {
						await api.channels.deleteMessage(panel.channelId, oldMessageId);
					} catch (cleanupError) {
						req.logger.warn({ err: cleanupError }, 'failed to clean up stale panel message after resync');
					}
				})();
			} catch (error) {
				req.logger.error({ err: error, guildId, panelId: panel.id }, 'failed to resync panel');
				failures.push({ item: `panel ${panel.id}`, error: error instanceof Error ? error.message : String(error) });
			}
		}

		return { failures, panelsReposted, snippetsRecreated, staleCommandsDeleted };
	},
});
