import { dirname, join } from 'node:path';
import { setInterval } from 'node:timers';
import { fileURLToPath } from 'node:url';
import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { registerCommandHandlers, registerComponentHandlers } from '@chatsift/bot-core';
import type { Categories, GuildSettings, Threads } from '@chatsift/db';
import type { Client, GatewayMessageCreateDispatchData } from '@discordjs/core';
import { ComponentType, GatewayDispatchEvents, MessageReferenceType } from '@discordjs/core';
import { nanoid } from 'nanoid';
import { CategorySelectStore } from './lib/categoryState.js';
import { withGuildUserLock } from './lib/guildUserQueue.js';
import { resolveEffectiveContent, resolveReplyNote } from './lib/messageContext.js';
import { clearPendingTicketRecord, PendingTicketStore } from './lib/pendingTicket.js';
import { sweepAbandonedPendingTickets } from './lib/pendingTicketSweep.js';
import { relayUserMessageToModThread } from './lib/relay.js';
import { findOpenThreadByUserThreadId } from './lib/threads.js';
import { finishTicketCreation, sendGreeting } from './lib/ticketCreation.js';

/**
 * How often `sweepAbandonedPendingTickets` runs — short enough that an abandoned thread doesn't sit
 * around much past its actual timeout, long enough to not be pointlessly hammering the DB (the table
 * is expected to stay small: only tickets currently mid-setup have a row at all).
 */
const PENDING_TICKET_SWEEP_INTERVAL_MS = 5 * 60 * 1_000;

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
	// Gated behind the same per guild+user lock as the button click and category pick (see
	// `lib/guildUserQueue.ts`) so all three ticket-lifecycle events for one user are strictly ordered.
	await withGuildUserLock(pending.guildId, pending.userId, async () => {
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

		// Re-checked against the DB rather than trusting `pending.categoryIds.length` alone — those ids
		// were captured at button-click time, and a category could've been deleted in the gap before the
		// user's first message arrived. Either way (none configured, or none left), the outcome is the
		// same: skip the category prompt and finish the ticket outright instead of rendering a select
		// with zero options (which Discord rejects).
		const categories =
			pending.categoryIds.length === 0
				? []
				: await getContext().db<Categories[]>`
						SELECT * FROM categories WHERE guild_id = ${pending.guildId} AND id IN ${getContext().db(pending.categoryIds)}
						ORDER BY sort_order, id
					`;

		if (categories.length === 0) {
			try {
				const thread = await finishTicketCreation({
					alertRoleId: guildSettings.alertRoleId,
					category: null,
					createdById: pending.userId,
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

				// Only cleared here, on success — `PendingTicketStore` is what lets a *retry* (the user
				// just sending another message) re-enter this same function after a failure below, so it
				// must survive a thrown error instead of being consumed no matter what. `pending_tickets`
				// (the durable row) is cleared alongside it for the same reason: on failure it needs to
				// stay put so it keeps counting against `countActiveTicketsForUser` (lib/threads.ts) and
				// stays visible to the abandoned-ticket sweep (lib/pendingTicketSweep.ts) — clearing it
				// unconditionally would let the count silently drop and orphan the private thread from the
				// sweep the moment `finishTicketCreation`/the relay/the greeting failed below.
				await Promise.all([
					PendingTicketStore.delete(message.channel_id),
					clearPendingTicketRecord(message.channel_id),
				]);
			} catch (error) {
				logger.error(
					{ err: error, guildId: pending.guildId, userId: pending.userId },
					'Failed to finish ticket creation from the first message',
				);
				await getContext().service.client.api.channels.createMessage(message.channel_id, {
					content:
						'❌ Something went wrong setting up your ticket. Please try sending your message again, or contact a moderator.',
				});
			}

			return;
		}

		try {
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
				// No thread exists yet for a first message, so there's no history a reply could
				// meaningfully point at — just remember whether it was a reply at all, `categorySelect.ts`
				// renders the generic note rather than looking up a specific (necessarily nonexistent)
				// local message id.
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

			// As above: only cleared on success, so a failure here (e.g. the createMessage call itself
			// failing) leaves the user able to retry by sending another message instead of being stuck
			// with neither an open thread nor a pending one to route against.
			await PendingTicketStore.delete(message.channel_id);
		} catch (error) {
			logger.error(
				{ err: error, guildId: pending.guildId, userId: pending.userId },
				'Failed to prompt for a category after the first message',
			);
			await getContext().service.client.api.channels.createMessage(message.channel_id, {
				content:
					'❌ Something went wrong setting up your ticket. Please try sending your message again, or contact a moderator.',
			});
		}
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
				// `handleFirstMessage` deletes this itself, and only once it actually succeeds — deleting
				// it eagerly here would strand the user with a dead thread on any failure inside it (see
				// the comments in `handleFirstMessage`).
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

	// `.unref()` so this interval never keeps the process alive on its own — matches bot-core's
	// client.ts guild-list-sync interval, the only other recurring background loop in the codebase.
	setInterval(async () => {
		try {
			await sweepAbandonedPendingTickets(getContext().logger);
		} catch (error) {
			getContext().logger.error({ err: error }, 'Failed to sweep abandoned pending tickets');
		}
	}, PENDING_TICKET_SWEEP_INTERVAL_MS).unref();
}
