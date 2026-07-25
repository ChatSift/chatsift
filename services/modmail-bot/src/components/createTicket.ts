import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import type { Categories, GuildSettings, TicketPanels } from '@chatsift/db';
import type { APIMessageComponentInteraction } from '@discordjs/core';
import { ChannelType, MessageFlags } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { PendingTicketStore } from '../lib/pendingTicket.js';
import { findOpenThreadForUser } from '../lib/threads.js';

export default class CreateTicketComponent implements ComponentHandler {
	public readonly name = 'modmail-create-ticket';

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, _state: never, logger: Logger) {
		const guildId = interaction.guild_id;
		const member = interaction.member;
		if (!guildId || !member) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'This can only be used in a server.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const user = member.user;

		const existing = await findOpenThreadForUser(guildId, user.id);
		if (existing) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: existing.userThreadId
					? `You already have an open ticket: <#${existing.userThreadId}>`
					: 'You already have an open ticket in this server.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const [panel] = await getContext().db<TicketPanels[]>`
			SELECT * FROM ticket_panels WHERE message_id = ${interaction.message.id}
		`;

		if (!panel) {
			logger.error({ messageId: interaction.message.id }, 'No ticket panel found for create-ticket interaction');
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'Something went wrong resolving this ticket panel. Please let a moderator know.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const [guildSettings] = await getContext().db<GuildSettings[]>`
			SELECT * FROM guild_settings WHERE guild_id = ${guildId}
		`;

		if (!guildSettings?.modForumId) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'ModMail is not fully configured in this server yet. Please let a moderator know.',
				flags: MessageFlags.Ephemeral,
			});
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
				await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
					content: 'The bot is missing permissions to create a ticket thread here. Please let a moderator know.',
					flags: MessageFlags.Ephemeral,
				});
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
		await PendingTicketStore.set(privateThread.id, {
			categoryIds: categories.map((category) => category.id),
			guildId,
			userId: user.id,
		});

		await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
			content: `Your ticket has been created: <#${privateThread.id}>. Describe what you need help with there — a staff member will follow up once you send your message.`,
			flags: MessageFlags.Ephemeral,
		});
	}
}
