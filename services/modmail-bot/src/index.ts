import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { registerCommandHandlers, registerComponentHandlers } from '@chatsift/bot-core';
import type { Categories, GuildSettings, Threads } from '@chatsift/db';
import type { Client, GatewayMessageCreateDispatchData } from '@discordjs/core';
import { ComponentType, GatewayDispatchEvents, MessageReferenceType } from '@discordjs/core';
import { nanoid } from 'nanoid';
import { CategorySelectStore } from './lib/categoryState.js';
import { resolveEffectiveContent, resolveReplyNote } from './lib/messageContext.js';
import { PendingTicketStore } from './lib/pendingTicket.js';
import { relayUserMessageToModThread } from './lib/relay.js';
import { findOpenThreadByUserThreadId } from './lib/threads.js';
import { finishTicketCreation, sendGreeting } from './lib/ticketCreation.js';

const baseDir = dirname(fileURLToPath(import.meta.url));

/**
 * Forwarded messages get their own note (there's no earlier local message number to point at, unlike
 * a reply) — everything else defers to `resolveReplyNote`, which itself returns `undefined` when the
 * message isn't a reply at all.
 */
async function buildContextNote(
	message: GatewayMessageCreateDispatchData,
	isForwarded: boolean,
	thread: Pick<Threads, 'guildId' | 'id' | 'modThreadId'>,
	logger: Logger,
): Promise<string | undefined> {
	if (isForwarded) {
		return '📨 *Forwarded message*';
	}

	return resolveReplyNote(thread, message, logger);
}

/**
 * A private thread exists (`createTicket.ts` created it) but nothing has been sent to staff yet —
 * this is the user's first message. Either finishes the ticket outright (no categories configured
 * for the panel) or prompts for a category next; either way the message that triggered this is
 * captured so it reaches staff together with the category once one is resolved (see
 * `categorySelect.ts` for the deferred-category path).
 */
async function handleFirstMessage(
	message: GatewayMessageCreateDispatchData,
	pending: { categoryIds: number[]; guildId: string; userId: string },
	logger: Logger,
): Promise<void> {
	const effective = resolveEffectiveContent(message);

	const [guildSettings] = await getContext().db<GuildSettings[]>`
		SELECT * FROM guild_settings WHERE guild_id = ${pending.guildId}
	`;

	if (!guildSettings?.modForumId) {
		logger.warn({ guildId: pending.guildId }, 'ModMail configuration disappeared while a ticket was pending');
		await getContext().service.client.api.channels.createMessage(message.channel_id, {
			content: 'ModMail is no longer configured in this server. Please contact a moderator directly.',
		});
		return;
	}

	if (pending.categoryIds.length === 0) {
		const thread = await finishTicketCreation({
			alertRoleId: guildSettings.alertRoleId,
			category: null,
			createdById: pending.userId,
			defaultGreetingMessage: guildSettings.defaultGreetingMessage,
			guildId: pending.guildId,
			logger,
			member: message.member,
			modForumId: guildSettings.modForumId,
			privateThreadId: message.channel_id,
			user: message.author,
		});

		await relayUserMessageToModThread({
			attachments: effective.attachments,
			contextNote: await buildContextNote(message, effective.isForwarded, thread, logger),
			content: effective.content,
			logger,
			member: message.member,
			messageId: message.id,
			stickers: effective.stickers,
			thread,
			user: message.author,
		});

		await sendGreeting({
			category: null,
			defaultGreetingMessage: guildSettings.defaultGreetingMessage,
			guildId: pending.guildId,
			member: message.member,
			modThreadId: thread.modThreadId,
			privateThreadId: message.channel_id,
			user: message.author,
		});
		return;
	}

	const categories = await getContext().db<Categories[]>`
		SELECT * FROM categories WHERE guild_id = ${pending.guildId} AND id IN ${getContext().db(pending.categoryIds)}
		ORDER BY sort_order, id
	`;

	const stateId = nanoid();
	await CategorySelectStore.set(stateId, {
		attachments: effective.attachments.map((attachment) => ({
			url: attachment.url,
			filename: attachment.filename,
			contentType: attachment.content_type ?? '',
			size: attachment.size,
		})),
		categoryIds: pending.categoryIds,
		content: effective.content,
		isForwarded: effective.isForwarded,
		// No thread exists yet for a first message, so there's no history a reply could meaningfully
		// point at — just remember whether it was a reply at all, `categorySelect.ts` renders the
		// generic note rather than looking up a specific (necessarily nonexistent) local message id.
		isReply:
			Boolean(message.message_reference?.message_id) &&
			message.message_reference?.type !== MessageReferenceType.Forward,
		messageId: message.id,
		stickers: effective.stickers.map((sticker) => ({
			id: sticker.id,
			name: sticker.name,
			formatType: sticker.format_type,
		})),
	});

	await getContext().service.client.api.channels.createMessage(message.channel_id, {
		content: 'Thanks! Please pick a category for your ticket:',
		components: [
			{
				type: ComponentType.ActionRow,
				components: [
					{
						type: ComponentType.StringSelect,
						custom_id: `modmail-category-select:${stateId}`,
						placeholder: 'Select a category',
						options: categories.map((category) => ({
							label: category.name.slice(0, 100),
							value: String(category.id),
							...(category.description ? { description: category.description.slice(0, 100) } : {}),
							...(category.emoji ? { emoji: { name: category.emoji } } : {}),
						})),
					},
				],
			},
		],
	});
}

/**
 * bot-core's `Client` only dispatches interactions (see `@chatsift/bot-core`'s `client.ts`) — AMA never
 * needed raw messages. ModMail's user → mod relay direction is message-driven (a user just types in
 * their private thread), so this service attaches its own `MessageCreate` listener directly instead of
 * extending the shared framework for a need only this bot has.
 */
function registerMessageRelay(client: Client): void {
	client.on(GatewayDispatchEvents.MessageCreate, async ({ data: message }) => {
		if (message.author.bot) {
			return;
		}

		const logger = getContext().logger.child({ event: 'messageCreate', channelId: message.channel_id });

		try {
			const thread = await findOpenThreadByUserThreadId(message.channel_id);
			if (thread) {
				const effective = resolveEffectiveContent(message);
				await relayUserMessageToModThread({
					attachments: effective.attachments,
					contextNote: await buildContextNote(message, effective.isForwarded, thread, logger),
					content: effective.content,
					logger,
					member: message.member,
					messageId: message.id,
					stickers: effective.stickers,
					thread,
					user: message.author,
				});
				return;
			}

			const pending = await PendingTicketStore.get(message.channel_id);
			if (pending) {
				await PendingTicketStore.delete(message.channel_id);
				await handleFirstMessage(message, pending, logger);
			}
		} catch (error) {
			logger.error({ err: error }, 'Failed to handle message in modmail-bot');
		}
	});
}

export async function bin(client: Client): Promise<void> {
	await registerComponentHandlers(join(baseDir, 'components'));
	await registerCommandHandlers(join(baseDir, 'commands'));
	registerMessageRelay(client);
}
