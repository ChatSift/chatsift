import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import type { Categories, GuildSettings, TicketPanels } from '@chatsift/db';
import type { APIMessageComponentEmoji, APIMessageComponentInteraction } from '@discordjs/core';
import { ChannelType, ComponentType, MessageFlags } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { findActiveBlock } from '../lib/blocks.js';
import { withGuildUserLock } from '../lib/guildUserQueue.js';
import { PendingTicketStore, recordPendingTicket } from '../lib/pendingTicket.js';
import { countActiveTicketsForUser, MAX_THREAD_AUTO_ARCHIVE_DURATION_MINUTES } from '../lib/threads.js';

// Matches Discord's own shorthand for a custom guild emoji (`<:name:id>`, `<a:name:id>` for animated) --
// the same shape the dashboard's `EmojiInput.tsx` writes into `Category.emoji` when a custom emoji is
// picked (see `apps/website`'s `Emoji.tsx` for the identical pattern used to render it back). A select
// option's `emoji` field needs `{ id, name }` for a custom emoji (Discord renders it from the id, the
// name is just accessibility metadata) versus `{ name }` alone for a plain unicode emoji -- passing the
// raw `<:name:id>` string through as `name` renders literal angle-bracket text instead of the emoji.
const CUSTOM_EMOJI_REGEX = /^<(?<animated>a)?:(?<name>\w{2,32}):(?<id>\d{17,20})>$/;

function categoryOptionEmoji(emoji: string): APIMessageComponentEmoji {
	const match = CUSTOM_EMOJI_REGEX.exec(emoji);
	if (!match?.groups) {
		return { name: emoji };
	}

	// `name` and `id` are always captured when the regex matches at all -- only `animated` is an
	// optional group -- so the non-null assertions just narrow past `groups`' blanket
	// `string | undefined` index-signature typing, they're not asserting past anything actually unknown.
	return {
		id: match.groups['id']!,
		name: match.groups['name']!,
		...(match.groups['animated'] ? { animated: true } : {}),
	};
}

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

			if (categories.length > 0) {
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
									options: categories.map((category) => ({
										label: category.name.slice(0, 100),
										value: String(category.id),
										...(category.description ? { description: category.description.slice(0, 100) } : {}),
										...(category.emoji ? { emoji: categoryOptionEmoji(category.emoji) } : {}),
									})),
								},
							],
						},
					],
				});
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

			// Nothing is posted into the thread itself and nothing is sent to staff yet — the mod-forum
			// thread only gets created once the user's first message arrives, caught by `index.ts`'s
			// `MessageCreate` listener via this pending-ticket record. This panel has no categories, so
			// `categoryId` is `0` ("none") from the start — contrast `categorySelect.ts`, which is the one
			// that creates this record when a panel *does* have categories, once a pick resolves one. The
			// "what do I do now" instruction lives solely in this ephemeral reply (only the ticket opener
			// sees it) rather than as a standalone bot message left sitting in an otherwise-empty thread.
			await Promise.all([
				PendingTicketStore.set(privateThread.id, {
					categoryId: 0,
					guildId,
					userId: user.id,
				}),
				recordPendingTicket({ categoryId: null, guildId, privateThreadId: privateThread.id, userId: user.id }),
			]);

			await editReply(
				`Your ticket has been created: <#${privateThread.id}>. Describe what you need help with there — a staff member will follow up once you send your message.`,
			);
		});
	}
}
