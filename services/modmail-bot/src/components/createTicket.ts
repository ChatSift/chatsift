import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import type { Categories, GuildSettings, TicketPanels } from '@chatsift/db';
import type { APIMessageComponentInteraction } from '@discordjs/core';
import { ChannelType, MessageFlags } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { withGuildUserLock } from '../lib/guildUserQueue.js';
import { PendingTicketByUserStore, PendingTicketStore, recordPendingTicket } from '../lib/pendingTicket.js';
import { findOpenThreadForUser } from '../lib/threads.js';

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
		// the `PendingTicketByUserStore` check below is what catches a second click minutes later, once
		// the first click's handler has already returned but before a real `threads` row exists.
		await withGuildUserLock(guildId, user.id, async () => {
			const existing = await findOpenThreadForUser(guildId, user.id);
			if (existing) {
				await editReply(
					existing.userThreadId
						? `You already have an open ticket: <#${existing.userThreadId}>`
						: 'You already have an open ticket in this server.',
				);
				return;
			}

			const pendingKey = `${guildId}:${user.id}`;
			const pendingForUser = await PendingTicketByUserStore.get(pendingKey);
			if (pendingForUser) {
				await editReply(`You already have a ticket being set up: <#${pendingForUser.privateThreadId}>`);
				return;
			}

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

			const categories = await getContext().db<Categories[]>`
				SELECT c.* FROM categories c
				INNER JOIN ticket_panel_categories tpc ON tpc.category_id = c.id
				WHERE tpc.ticket_panel_id = ${panel.id}
				ORDER BY c.sort_order, c.id
			`;

			let privateThread;
			try {
				privateThread = await getContext().service.client.api.channels.createThread(panel.channelId, {
					name: (member.nick ?? user.global_name ?? user.username).slice(0, 100),
					type: ChannelType.PrivateThread,
					invitable: false,
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
			// thread (and, if there are categories, the category prompt) only gets created once the
			// user's first message arrives, caught by `index.ts`'s `MessageCreate` listener via this
			// pending-ticket record. The "what do I do now" instruction lives solely in this ephemeral
			// reply (only the ticket opener sees it) rather than as a standalone bot message left sitting
			// in an otherwise-empty thread.
			await Promise.all([
				PendingTicketStore.set(privateThread.id, {
					categoryIds: categories.map((category) => category.id),
					guildId,
					userId: user.id,
				}),
				PendingTicketByUserStore.set(pendingKey, { privateThreadId: privateThread.id }),
				recordPendingTicket({ guildId, privateThreadId: privateThread.id, userId: user.id }),
			]);

			await editReply(
				`Your ticket has been created: <#${privateThread.id}>. Describe what you need help with there — a staff member will follow up once you send your message.`,
			);
		});
	}
}
