import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import type { Categories, GuildSettings, TicketPanels } from '@chatsift/db';
import type { APIMessageComponentInteraction } from '@discordjs/core';
import { ComponentType, MessageFlags } from '@discordjs/core';
import { findActiveBlock } from '../lib/blocks.js';
import { buildCategorySelectOptions } from '../lib/categorySelectOptions.js';
import { withGuildUserLock } from '../lib/guildUserQueue.js';
import { createPanelTicket } from '../lib/panelTicket.js';
import { countActiveTicketsForUser } from '../lib/threads.js';

export default class CreateTicketComponent implements ComponentHandler {
	public readonly name = 'modmail-create-ticket';

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, _state: never, logger: Logger) {
		// Deferred immediately — everything below is a chain of DB queries plus a thread create/addMember
		// call, which comfortably outlasts Discord's 3-second component-ack window under any real load.
		// Every branch below replies via `editReply` against this defer instead of a fresh `reply`.
		await getContext().service.client.api.interactions.defer(interaction.id, interaction.token, {
			flags: MessageFlags.Ephemeral,
		});

		const editReply = async (content: string) => {
			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content,
			});
		};

		const guildId = interaction.guild_id;
		const member = interaction.member;
		if (!guildId || !member) {
			await editReply('This can only be used in a server.');
			return;
		}

		const user = member.user;

		// Everything from here on is gated behind a per guild+user lock (see `lib/guildUserQueue.ts`):
		// the interaction is already deferred, so waiting here just delays the eventual `editReply`
		// rather than risking a missed ack. The lock alone only makes truly *concurrent* clicks safe —
		// the `countActiveTicketsForUser` check below is what catches a second click minutes later, once
		// the first click's handler has already returned but before a real `threads` row exists.
		await withGuildUserLock(guildId, user.id, async () => {
			const [panel] = await getContext().db<TicketPanels[]>`
				SELECT * FROM ticket_panels WHERE message_id = ${interaction.message.id}
			`;

			if (!panel) {
				logger.error({ messageId: interaction.message.id }, 'No ticket panel found for create-ticket interaction');
				await editReply('Something went wrong resolving this ticket panel. Please let a moderator know.');
				return;
			}

			const [guildSettings] = await getContext().db<GuildSettings[]>`
				SELECT * FROM guild_settings WHERE guild_id = ${guildId}
			`;

			if (!guildSettings?.modForumId) {
				await editReply('ModMail is not fully configured in this server yet. Please let a moderator know.');
				return;
			}

			// Panels are never auto-deleted when DM mode is turned on (decision 9 in
			// docs/roadmap/01-architecture.md §8) -- a leftover button click is inert instead,
			// pointing the user at the actual entry point, so flipping DM mode back off restores the panel
			// flow exactly as configured.
			if (guildSettings.dmMode) {
				await editReply('This server uses DMs - just message the bot directly to open a ticket.');
				return;
			}

			const block = await findActiveBlock(guildId, user.id);
			if (block) {
				await editReply(
					block.expiresAt
						? `You are blocked from opening ModMail tickets in this server until <t:${Math.floor(block.expiresAt.getTime() / 1_000)}:f>.`
						: 'You are blocked from opening ModMail tickets in this server.',
				);
				return;
			}

			const maxConcurrentThreads = guildSettings.maxConcurrentThreads;
			const activeCount = await countActiveTicketsForUser(guildId, user.id);
			if (activeCount >= maxConcurrentThreads) {
				await editReply(
					maxConcurrentThreads === 1
						? 'You already have an open ticket in this server. Close it before opening another.'
						: `You already have ${activeCount} open ticket(s) in this server (limit: ${maxConcurrentThreads}). Close one before opening another.`,
				);
				return;
			}

			const categories = await getContext().db<Categories[]>`
				SELECT c.* FROM categories c
				INNER JOIN ticket_panel_categories tpc ON tpc.category_id = c.id
				WHERE tpc.ticket_panel_id = ${panel.id}
				ORDER BY c.sort_order, c.id
			`;

			// A single-category panel has nothing to actually pick — a one-option select is an extra click
			// that can only ever resolve one way — so only two or more categories get a picker. One or zero
			// both fall through to `createPanelTicket` below, which takes the category (or `null`) straight
			// through. `lib/dmTicket.ts` does the same for DM mode.
			if (categories.length > 1) {
				// No private thread yet — the user picks a category first, ephemerally, right here in
				// response to the button. `categorySelect.ts` is the one that actually creates the private
				// thread once a pick lands; `panel.id` rides along in the custom_id since nothing about this
				// pick needs to be stashed anywhere in the meantime. Everything checked above (block,
				// concurrent-ticket limit, guild config) is only a fast pre-check — nothing here reserves a
				// slot the way the old thread-first flow did, so `categorySelect.ts` re-runs every one of
				// these checks itself, under its own lock, immediately before it actually creates the thread.
				await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
					content: 'Please pick a category for your ticket:',
					components: [
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.StringSelect,
									custom_id: `modmail-category-select:${panel.id}`,
									placeholder: 'Select a category',
									options: buildCategorySelectOptions(categories),
								},
							],
						},
					],
				});
				return;
			}

			await createPanelTicket({
				category: categories[0] ?? null,
				guildId,
				guildSettings,
				interaction,
				logger,
				member,
				panel,
			});
		});
	}
}
