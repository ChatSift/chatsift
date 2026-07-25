import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import type { Categories, GuildSettings } from '@chatsift/db';
import type { APIMessageComponentInteraction, APIMessageStringSelectInteractionData } from '@discordjs/core';
import { MessageFlags } from '@discordjs/core';
import { CategorySelectStore, type CategorySelectState } from '../lib/categoryState.js';
import { relayUserMessageToModThread } from '../lib/relay.js';
import { finishTicketCreation, sendGreeting } from '../lib/ticketCreation.js';

export default class CategorySelectComponent implements ComponentHandler<CategorySelectState> {
	public readonly name = 'modmail-category-select';

	public readonly stateStore = CategorySelectStore;

	public async handle(
		interaction: APIMessageComponentInteraction,
		state: CategorySelectState,
		logger: Logger,
	): Promise<void> {
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
		const data = interaction.data as APIMessageStringSelectInteractionData;
		const categoryId = Number(data.values[0]);

		if (!state.categoryIds.includes(categoryId)) {
			logger.warn({ categoryId, guildId }, 'Category select picked an id outside the stored allow-list');
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'That category is no longer available. Please contact a moderator.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const [category] = await getContext().db<Categories[]>`
			SELECT * FROM categories WHERE id = ${categoryId} AND guild_id = ${guildId}
		`;

		if (!category) {
			logger.warn({ categoryId, guildId }, 'Selected category no longer exists');
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'That category no longer exists. Please contact a moderator.',
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

		const thread = await finishTicketCreation({
			alertRoleId: guildSettings.alertRoleId,
			category,
			createdById: user.id,
			defaultGreetingMessage: guildSettings.defaultGreetingMessage,
			guildId,
			logger,
			member,
			modForumId: guildSettings.modForumId,
			privateThreadId: interaction.channel.id,
			user,
		});

		// The category prompt only fires after the user's first message (see `index.ts`), so that
		// message is stashed in `state` and relayed now — both the category and the message reach
		// staff together instead of an empty ticket showing up first. There's no thread history yet
		// to resolve a specific "replying to #N" for (see index.ts's `handleFirstMessage`), so a reply
		// only ever gets the generic note here.
		const contextNote = state.isForwarded
			? '📨 *Forwarded message*'
			: state.isReply
				? '↩️ *replying to an earlier message*'
				: undefined;

		await relayUserMessageToModThread({
			attachments: state.attachments.map((attachment) => ({
				url: attachment.url,
				filename: attachment.filename,
				content_type: attachment.contentType || undefined,
				size: attachment.size,
			})),
			contextNote,
			content: state.content,
			logger,
			member,
			messageId: state.messageId,
			stickers: state.stickers.map((sticker) => ({
				id: sticker.id,
				name: sticker.name,
				format_type: sticker.formatType,
			})),
			thread,
			user,
		});

		await sendGreeting({
			category,
			defaultGreetingMessage: guildSettings.defaultGreetingMessage,
			guildId,
			member,
			modThreadId: thread.modThreadId,
			privateThreadId: interaction.channel.id,
			user,
		});

		const stateId = data.custom_id.split(':')[1];
		if (stateId) {
			await CategorySelectStore.delete(stateId);
		}

		// Self-destruct rather than leaving a "Category selected: X" message behind — the category
		// pick was just a one-time fork in the setup flow, not something worth a permanent trace once
		// the actual ticket (with the user's message already relayed above) exists.
		await getContext().service.client.api.interactions.deferMessageUpdate(interaction.id, interaction.token);
		await getContext().service.client.api.channels.deleteMessage(interaction.channel.id, interaction.message.id);
	}
}
