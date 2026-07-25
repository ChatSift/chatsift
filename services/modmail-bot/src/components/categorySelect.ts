import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import type { Categories, GuildSettings } from '@chatsift/db';
import type { APIMessageComponentInteraction, APIMessageStringSelectInteractionData } from '@discordjs/core';
import { MessageFlags } from '@discordjs/core';
import { CategorySelectStore, type CategorySelectState } from '../lib/categoryState.js';
import { withGuildUserLock } from '../lib/guildUserQueue.js';
import { clearPendingTicketRecord, PendingTicketByUserStore } from '../lib/pendingTicket.js';
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

		// Captured before the closure below — narrowing from the `!guildSettings?.modForumId` guard
		// above doesn't flow into a nested function, so TypeScript would otherwise still see
		// `string | null` inside it.
		const modForumId = guildSettings.modForumId;

		// Deferred here, before the slow part (mod-forum thread creation, the relay's media re-upload,
		// the greeting) — all of that easily outlasts Discord's 3-second component-ack window, and the
		// self-destruct deleteMessage call below needs the interaction to still be alive when it runs.
		await getContext().service.client.api.interactions.deferMessageUpdate(interaction.id, interaction.token);

		await withGuildUserLock(guildId, user.id, async () => {
			try {
				const thread = await finishTicketCreation({
					alertRoleId: guildSettings.alertRoleId,
					category,
					createdById: user.id,
					guildId,
					logger,
					member,
					modForumId,
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
			} catch (error) {
				// Without this, a failure here would propagate straight out of `withGuildUserLock` and
				// skip both the state cleanup below and the self-destruct — leaving the category select
				// stuck on-screen forever with no feedback, since `deferMessageUpdate` above already
				// consumed the interaction's only implicit acknowledgement.
				logger.error({ err: error, guildId, userId: user.id }, 'Failed to finish ticket creation from category select');
				await getContext().service.client.api.interactions.followUp(interaction.application_id, interaction.token, {
					content: '❌ Something went wrong finishing your ticket. Please contact a moderator.',
					flags: MessageFlags.Ephemeral,
				});
			} finally {
				// Cleared regardless of outcome — a real `threads` row now exists to block re-creation on
				// success, and on failure the user shouldn't be stuck unable to retry until the 30-minute
				// TTL catches up. Also drops the durable pending_tickets row so the abandoned-ticket sweep
				// (lib/pendingTicketSweep.ts) doesn't try to clean up a thread that already resolved.
				await Promise.all([
					PendingTicketByUserStore.delete(`${guildId}:${user.id}`),
					clearPendingTicketRecord(interaction.channel.id),
				]);
			}

			const stateId = data.custom_id.split(':')[1];
			if (stateId) {
				await CategorySelectStore.delete(stateId);
			}

			// Self-destruct rather than leaving a "Category selected: X" message behind — the category
			// pick was just a one-time fork in the setup flow, not something worth a permanent trace once
			// the actual ticket (with the user's message already relayed above) exists.
			await getContext().service.client.api.channels.deleteMessage(interaction.channel.id, interaction.message.id);
		});
	}
}
