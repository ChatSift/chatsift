import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import type { Categories, GuildSettings, TicketPanels } from '@chatsift/db';
import type { APIMessageComponentInteraction, APIMessageStringSelectInteractionData } from '@discordjs/core';
import { ChannelType } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { findActiveBlock } from '../lib/blocks.js';
import { withGuildUserLock } from '../lib/guildUserQueue.js';
import { PendingTicketStore, recordPendingTicket } from '../lib/pendingTicket.js';
import {
	countActiveTicketsForUser,
	countOpenThreadsForUserInCategory,
	MAX_THREAD_AUTO_ARCHIVE_DURATION_MINUTES,
} from '../lib/threads.js';

/**
 * The category picker (`createTicket.ts`) is itself the ephemeral response to the "Create Ticket"
 * button — there's no separate real message to self-destruct once a pick resolves, unlike the old
 * thread-first flow. Every branch below edits that same ephemeral response in place instead (deferred
 * via `deferMessageUpdate`, resolved via `editReply`, which targets the original response the same way
 * `createTicket.ts`'s plain `defer`/`editReply` pair does).
 */
export default class CategorySelectComponent implements ComponentHandler {
	public readonly name = 'modmail-category-select';

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, _state: never, logger: Logger): Promise<void> {
		await getContext().service.client.api.interactions.deferMessageUpdate(interaction.id, interaction.token);

		const editReply = async (content: string) => {
			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content,
				components: [],
			});
		};

		const guildId = interaction.guild_id;
		const member = interaction.member;
		if (!guildId || !member) {
			await editReply('This can only be used in a server.');
			return;
		}

		const user = member.user;
		const data = interaction.data as APIMessageStringSelectInteractionData;
		const categoryId = Number(data.values[0]);
		const panelId = Number(data.custom_id.split(':')[1]);

		// Everything from here on is gated behind the same per guild+user lock every other
		// ticket-lifecycle step uses (see `lib/guildUserQueue.ts`) — nothing reserved a slot back at
		// button-click time in this flow, so every check `createTicket.ts` already did once (fast,
		// unlocked) gets its authoritative recheck here, immediately before the thread actually gets
		// created.
		await withGuildUserLock(guildId, user.id, async () => {
			// Re-fetched (rather than trusting `interaction.channel`) so the thread always lands in the
			// panel's *configured* parent channel, not wherever this component interaction happens to
			// report as its channel — this also doubles as the "does the panel still exist" check a
			// deleted panel would otherwise only surface indirectly via an empty `categories` result below.
			const [panel] = await getContext().db<TicketPanels[]>`
				SELECT * FROM ticket_panels WHERE id = ${panelId} AND guild_id = ${guildId}
			`;

			if (!panel) {
				logger.warn({ panelId, guildId }, 'Category select picked a panel that no longer exists');
				await editReply('That ticket panel no longer exists. Please open a new ticket.');
				return;
			}

			const categories = await getContext().db<Categories[]>`
				SELECT c.* FROM categories c
				INNER JOIN ticket_panel_categories tpc ON tpc.category_id = c.id
				WHERE tpc.ticket_panel_id = ${panel.id}
				ORDER BY c.sort_order, c.id
			`;

			const category = categories.find((candidate) => candidate.id === categoryId);
			if (!category) {
				logger.warn({ categoryId, panelId, guildId }, 'Category select picked an id no longer offered by its panel');
				await editReply('That category is no longer available. Please open a new ticket.');
				return;
			}

			const [guildSettings] = await getContext().db<GuildSettings[]>`
				SELECT * FROM guild_settings WHERE guild_id = ${guildId}
			`;

			if (!guildSettings?.modForumId) {
				await editReply('ModMail is not fully configured in this server yet. Please let a moderator know.');
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

			// `category.maxConcurrentThreads` is nullable ("inherit the guild's general limit") and is
			// clamped to the guild's current value regardless — see the same comment in the old revision
			// of this file (git history) for the write-side/read-side split this defends against.
			const categoryMax =
				category.maxConcurrentThreads === null
					? guildSettings.maxConcurrentThreads
					: Math.min(category.maxConcurrentThreads, guildSettings.maxConcurrentThreads);

			const openInCategory = await countOpenThreadsForUserInCategory(guildId, user.id, category.id);
			if (openInCategory >= categoryMax) {
				await editReply(
					openInCategory === 1 && categoryMax === 1
						? `You already have an open ticket in the "${category.name}" category. Close it before opening another there.`
						: `You already have ${openInCategory} open ticket(s) in the "${category.name}" category (limit: ${categoryMax}). Close one before opening another there.`,
				);
				return;
			}

			let privateThread;
			try {
				privateThread = await getContext().service.client.api.channels.createThread(panel.channelId, {
					name: (member.nick ?? user.global_name ?? user.username).slice(0, 100),
					type: ChannelType.PrivateThread,
					invitable: false,
					auto_archive_duration: MAX_THREAD_AUTO_ARCHIVE_DURATION_MINUTES,
				});
			} catch (error) {
				if (error instanceof DiscordAPIError && error.status === 403) {
					logger.warn({ err: error, channelId: panel.channelId }, 'Missing permissions to create a ticket thread');
					await editReply(
						'The bot is missing permissions to create a ticket thread here. Please let a moderator know.',
					);
					return;
				}

				throw error;
			}

			await getContext().service.client.api.threads.addMember(privateThread.id, user.id);

			// Same pending-ticket bridge as the zero-category path in `createTicket.ts` — the mod-forum
			// thread and greeting still only get created once the user's first message arrives (`index.ts`),
			// but the category itself is already resolved, so `categoryId` here is real rather than `0`.
			await Promise.all([
				PendingTicketStore.set(privateThread.id, {
					categoryId: category.id,
					guildId,
					userId: user.id,
				}),
				recordPendingTicket({ guildId, privateThreadId: privateThread.id, userId: user.id }),
			]);

			await editReply(
				`Your ticket has been created: <#${privateThread.id}>. Describe what you need help with there — a staff member will follow up once you send your message.`,
			);
		});
	}
}
