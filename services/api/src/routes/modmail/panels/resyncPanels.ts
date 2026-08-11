import { getContext } from '@chatsift/backend-core';
import type { TicketPanels } from '@chatsift/db';
import type { APIButtonComponentWithCustomId, RESTPostAPIChannelMessageJSONBody } from '@discordjs/core';
import { ComponentType, RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { apiForGuild } from '../../../util/discordAPI.js';
import type { ResyncFailure } from '../../../util/resync.js';
import { describeError } from '../../../util/resync.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { buildPanelComponents, DEFAULT_PANEL_BUTTON_LABEL } from '../discordBodies.js';

const bodySchema = z.strictObject({});
const paramsSchema = z.object({ guildId: snowflakeSchema });

export interface ResyncPanelsResult {
	/**
	 * Per-item failures that didn't stop the rest of the resync -- one bad panel (a transient Discord error, a
	 * DB write that failed after a Discord call already succeeded) shouldn't block reposting every other panel
	 * in the guild. Empty on a fully clean run.
	 */
	failures: ResyncFailure[];
	panelsReposted: number;
}

/**
 * See docs/roadmap/01-architecture.md §8. A guild swapping which application owns it (public to/from a custom
 * instance, or between two custom instances) orphans everything Discord scopes to an application id -- a
 * panel's message belongs to whoever posted it, not to the guild, so the newly-owning application can't edit
 * it. This route reconciles the guild's panel messages against whichever application currently owns `guildId`
 * (`apiForGuild`, registry-driven); `snippets/resyncSnippets.ts` does the same for snippet commands.
 *
 * Deliberately not run automatically on a swap (decision 10) -- ownership can flap (a row edited twice in
 * quick succession, a bad deploy rolled back) and reposting every panel on every registry refresh would be
 * wasteful and, worse, would repost panels that never needed it. An explicit button run once after a
 * deliberate swap is simpler to reason about.
 */
export default defineRoute({
	method: 'post',
	path: '/v3/guilds/:guildId/modmail/panels/resync',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<ResyncPanelsResult> {
		const { guildId } = req.params;
		const db = getContext().db;
		const api = apiForGuild('MODMAIL', guildId);

		// A message belongs to whichever application posted it. Editing it under a *different* application
		// fails with `CannotEditMessageAuthoredByAnotherUser` (or `UnknownMessage` if it's gone entirely) --
		// exactly the "this panel predates the current owner" signal, and a successful edit means it already
		// belongs here, nothing to do.
		const panels = await db<TicketPanels[]>`SELECT * FROM ticket_panels WHERE guild_id = ${guildId}`;

		let panelsReposted = 0;
		const failures: ResyncFailure[] = [];

		// Each panel is handled in isolation -- one panel's Discord/DB failure shouldn't block reposting every
		// other panel in the guild.
		for (const panel of panels) {
			try {
				const messageBodyBase = JSON.parse(panel.panelJsonData) as RESTPostAPIChannelMessageJSONBody;

				// The button's label lives only on the live Discord message, not in `panel_json_data` (see
				// createPanel.ts) -- read it back off the current message before we potentially lose access to
				// it, falling back to the default if the message is gone entirely rather than just foreign-owned.
				let buttonLabel = DEFAULT_PANEL_BUTTON_LABEL;
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

				const components = buildPanelComponents(buttonLabel);

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
						error: `reposted message ${newMessage.id} but failed to save it: ${describeError(dbError)}`,
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
				failures.push({ item: `panel ${panel.id}`, error: describeError(error) });
			}
		}

		return { failures, panelsReposted };
	},
});
