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

export interface ResyncModmailResult {
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

		for (const snippet of snippets) {
			try {
				await api.applicationCommands.getGuildCommand(applicationId, guildId, snippet.commandId);
				liveCommandIds.add(snippet.commandId);
			} catch (error) {
				if (!(error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownApplicationCommand)) {
					throw error;
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
				await db`UPDATE snippets SET command_id = ${command.id} WHERE id = ${snippet.id}`;
				liveCommandIds.add(command.id);
				snippetsRecreated++;
			}
		}

		// Anything registered under the current application that isn't one of the guild's live snippets is
		// an orphan -- either a leftover from a snippet since deleted, or (on a swap back to an application
		// this guild used before) a leftover from that earlier stint.
		const existingCommands = await api.applicationCommands.getGuildCommands(applicationId, guildId);
		let staleCommandsDeleted = 0;

		for (const command of existingCommands) {
			if (!liveCommandIds.has(command.id)) {
				await api.applicationCommands.deleteGuildCommand(applicationId, guildId, command.id);
				staleCommandsDeleted++;
			}
		}

		// Panels: a message belongs to whichever application posted it. Editing it under a *different*
		// application fails with `CannotEditMessageAuthoredByAnotherUser` (or `UnknownMessage` if it's gone
		// entirely) -- exactly the "this panel predates the current owner" signal, and a successful edit
		// means it already belongs here, nothing to do.
		const panels = await db<TicketPanels[]>`SELECT * FROM ticket_panels WHERE guild_id = ${guildId}`;
		let panelsReposted = 0;

		for (const panel of panels) {
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

			try {
				await api.channels.editMessage(panel.channelId, panel.messageId, { ...messageBodyBase, components });
				continue;
			} catch (error) {
				if (!(
					error instanceof DiscordAPIError &&
					(error.code === RESTJSONErrorCodes.CannotEditMessageAuthoredByAnotherUser ||
						error.code === RESTJSONErrorCodes.UnknownMessage)
				)) {
					throw error;
				}
			}

			const oldMessageId = panel.messageId;
			const newMessage = await api.channels.createMessage(panel.channelId, { ...messageBodyBase, components });
			await db`UPDATE ticket_panels SET message_id = ${newMessage.id} WHERE id = ${panel.id}`;
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
		}

		return { panelsReposted, snippetsRecreated, staleCommandsDeleted };
	},
});
