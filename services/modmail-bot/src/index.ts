import { dirname, join } from 'node:path';
import { setInterval, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';
import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { registerCommandHandlers, registerComponentHandlers, registerUnknownCommandResolver } from '@chatsift/bot-core';
import type { Categories, GuildSettings, Threads } from '@chatsift/db';
import type {
	APIChatInputApplicationCommandInteraction,
	Client,
	GatewayMessageCreateDispatchData,
} from '@discordjs/core';
import { ApplicationCommandType, GatewayDispatchEvents, MessageFlags } from '@discordjs/core';
import { ChatInputInteractionOptionResolver } from '@sapphire/discord-utilities';
import { buildForeignEmojiRejection, fetchGuildEmojiIds, findForeignEmojiTokens } from './lib/emojis.js';
import { withGuildUserLock } from './lib/guildUserQueue.js';
import { resolveEffectiveContent, resolveReplyNote } from './lib/messageContext.js';
import { clearPendingTicketRecord, PendingTicketStore, type PendingTicketState } from './lib/pendingTicket.js';
import { sweepAbandonedPendingTickets } from './lib/pendingTicketSweep.js';
import { preventOpenThreadsFromArchiving } from './lib/preventThreadArchive.js';
import { relayStaffReplyToUserThread, relayUserMessageToModThread } from './lib/relay.js';
import { sweepScheduledCloses } from './lib/scheduledCloseSweep.js';
import { findSnippetByCommandId, recordSnippetUsage } from './lib/snippets.js';
import { sweepThreadNukes } from './lib/threadNukeSweep.js';
import { findOpenThreadByModThreadId, findOpenThreadByUserThreadId } from './lib/threads.js';
import { finishTicketCreation, sendGreeting } from './lib/ticketCreation.js';

/**
 * How often `sweepAbandonedPendingTickets` runs — short enough that an abandoned thread doesn't sit
 * around much past its actual timeout, long enough to not be pointlessly hammering the DB (the table
 * is expected to stay small: only tickets currently mid-setup have a row at all).
 */
const PENDING_TICKET_SWEEP_INTERVAL_MS = 5 * 60 * 1_000;

/**
 * How often `sweepScheduledCloses` runs — `/close schedule`'s delay is minute-granularity, so this
 * needs to be short enough that a scheduled close doesn't fire noticeably late relative to what was
 * promised, while `scheduled_thread_closes` is expected to stay small (only tickets someone actually
 * scheduled a close for have a row at all).
 */
const SCHEDULED_CLOSE_SWEEP_INTERVAL_MS = 60 * 1_000;

/**
 * How often `sweepThreadNukes` runs — same minute-granularity reasoning as the scheduled-close sweep
 * above (`guild_settings.nuke_delay_minutes` is also minutes), and `scheduled_thread_nukes` is
 * similarly expected to stay small.
 */
const THREAD_NUKE_SWEEP_INTERVAL_MS = 60 * 1_000;

/**
 * How often `preventOpenThreadsFromArchiving` runs — matches prod `ChatSift/ModMail`'s
 * `preventAutoArchive` job interval. Short enough that an open ticket's thread doesn't stay archived
 * long after Discord's own inactivity timer trips it, long enough to not re-fetch every open ticket's
 * threads more often than needed.
 */
const PREVENT_THREAD_ARCHIVE_INTERVAL_MS = 5 * 60 * 1_000;

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
 * A private thread exists (`createTicket.ts` for a zero-category panel, `categorySelect.ts` once a
 * category's been picked) but nothing has been sent to staff yet — this is the user's first message,
 * finishing the ticket outright. The category (if any) is already resolved by this point, so unlike
 * the old thread-first flow this never needs to prompt for one here.
 */
async function handleFirstMessage(
	message: GatewayMessageCreateDispatchData,
	pending: PendingTicketState,
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

		// Re-fetched against the DB rather than trusting `pending.categoryId` alone — it was resolved
		// back when the private thread was created, and the category could've been deleted in the gap
		// before the user's first message arrived. Either way (never had one, or it's since gone), the
		// outcome is the same: finish the ticket as uncategorized.
		const category =
			pending.categoryId === 0
				? null
				: ((
						await getContext().db<Categories[]>`
							SELECT * FROM categories WHERE id = ${pending.categoryId} AND guild_id = ${pending.guildId}
						`
					)[0] ?? null);

		try {
			const thread = await finishTicketCreation({
				alertRoleId: guildSettings.alertRoleId,
				category,
				createdById: pending.userId,
				guildId: pending.guildId,
				logger,
				member: message.member,
				modForumId: guildSettings.modForumId,
				privateThreadId: message.channel_id,
				user: message.author,
			});

			// A real `threads` row now exists for this ticket, so the durable pending record needs to
			// go *now* — not deferred until after the relay/greeting below, which would leave both the
			// `threads` row and the `pending_tickets` row counting the same ticket simultaneously
			// against `countActiveTicketsForUser` (lib/threads.ts) for however long the relay/greeting
			// take, or indefinitely if either of them fails. Best-effort: a failure here shouldn't
			// unwind a ticket that was just successfully created (the row is otherwise harmless and
			// would eventually be caught by `lib/pendingTicketSweep.ts`'s stale-row cleanup, which skips
			// any pending row that already has a matching `threads` row), so it's caught and logged
			// rather than left to propagate into the catch below and misreport an already-created
			// ticket as a failure.
			try {
				await clearPendingTicketRecord(message.channel_id);
			} catch (error) {
				logger.warn(
					{ err: error, guildId: pending.guildId, threadId: thread.id, userId: pending.userId },
					'Failed to clear the pending_tickets row after finishing ticket creation',
				);
			}

			const relayOpener = async () =>
				relayUserMessageToModThread({
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

			const greetUser = async () =>
				sendGreeting({
					category,
					defaultGreetingMessage: guildSettings.defaultGreetingMessage,
					guildId: pending.guildId,
					member: message.member,
					modThreadId: thread.modThreadId,
					privateThreadId: message.channel_id,
					user: message.author,
				});

			if (guildSettings.greetingBeforeOpener) {
				await greetUser();
				await relayOpener();
			} else {
				await relayOpener();
				await greetUser();
			}

			// Only cleared here, on success — this is the routing index a *retry* (the user just
			// sending another message) would need to re-enter this same function after a failure below,
			// but by this point `pending_tickets` is already gone and a real `threads` row exists, so a
			// retry message actually routes through the normal open-thread relay path instead
			// (`registerMessageRelay`'s `findOpenThreadByUserThreadId` check runs before this store is
			// even consulted). Left in place on failure mostly as a harmless leftover — it just expires
			// via its own TTL once nothing keys off it anymore.
			await PendingTicketStore.delete(message.channel_id);
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

		const logger = getContext().logger.child({
			event: 'messageCreate',
			channelId: message.channel_id,
			guildId: message.guild_id ?? null,
		});

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

/**
 * Snippets are minted as their own per-guild slash command directly against Discord by the API
 * (`services/api/src/routes/modmail/snippets/createSnippet.ts`), so they never go through
 * `registerCommandHandlers`' static `commands/` directory — this is the fallback `@chatsift/bot-core`
 * calls when a command interaction's name doesn't match any statically-registered handler (see
 * `registerUnknownCommandResolver`). Returns `false` (not a snippet, or not usable here) to fall
 * through to bot-core's normal "no handler found" error for anything that isn't actually one of ours.
 */
function registerSnippetCommandResolver(): void {
	registerUnknownCommandResolver(async (interaction, logger) => {
		if (interaction.data.type !== ApplicationCommandType.ChatInput || !interaction.guild_id || !interaction.channel) {
			return false;
		}

		const snippet = await findSnippetByCommandId(interaction.guild_id, interaction.data.id);
		if (!snippet) {
			return false;
		}

		const member = interaction.member;
		if (!member) {
			return false;
		}

		// Deferred immediately once this is confirmed to actually be a snippet invocation (not before —
		// the two `return false`s above have to fall through to bot-core's own "no handler found" reply
		// untouched, not double-ack an interaction this resolver ends up not handling). Everything past
		// this point is a thread lookup plus the relay's DB/Discord-API work (including a possible media
		// re-upload), comfortably enough to risk outlasting Discord's 3-second ack window. Every branch
		// below replies via `editReply` against this defer instead of a fresh `reply`.
		await getContext().service.client.api.interactions.defer(interaction.id, interaction.token, {
			flags: MessageFlags.Ephemeral,
		});

		const editReply = async (content: string) => {
			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content,
			});
		};

		const thread = await findOpenThreadByModThreadId(interaction.channel.id);
		if (!thread) {
			await editReply('Snippets can only be used inside an open ModMail ticket thread.');
			return true;
		}

		const options = new ChatInputInteractionOptionResolver(interaction as APIChatInputApplicationCommandInteraction);
		const anon = options.getBoolean('anon') ?? false;

		const guildEmojiIds = await fetchGuildEmojiIds(interaction.guild_id, getContext().service.client.api, logger);
		if (!guildEmojiIds) {
			await editReply("⚠️ Couldn't verify this server's emotes right now. Please try again in a moment.");
			return true;
		}

		const foreignEmojiTokens = findForeignEmojiTokens(snippet.content, guildEmojiIds);
		if (foreignEmojiTokens.length > 0) {
			await getContext().service.client.api.interactions.editReply(
				interaction.application_id,
				interaction.token,
				buildForeignEmojiRejection(foreignEmojiTokens, snippet.content),
			);
			return true;
		}

		try {
			await relayStaffReplyToUserThread({
				anon,
				content: snippet.content,
				externalImageUrl: snippet.attachmentUrl ?? undefined,
				logger,
				staffMember: member,
				staffUser: member.user,
				thread,
			});
		} catch (error) {
			// Mirrors `commands/reply.ts`'s own try/catch around the same relay call — a failed relay means
			// nothing was actually sent, so usage tracking below must not run, and the deferred reply needs
			// an explicit failure message rather than being left to time out silently.
			logger.error({ err: error, snippetId: snippet.id, threadId: thread.id }, 'Failed to relay a snippet reply');
			await editReply('❌ Failed to send that snippet. Please try again or contact another moderator.');
			return true;
		}

		// Best-effort — the reply below is what actually acks this interaction, and the snippet has
		// already been relayed successfully at this point, so a usage-tracking write failure shouldn't
		// turn into a user-facing "something went wrong" for an action that in fact succeeded.
		try {
			await recordSnippetUsage(snippet.id);
		} catch (error) {
			logger.warn({ err: error, snippetId: snippet.id }, 'Failed to record snippet usage');
		}

		await editReply(`✅ Snippet "${snippet.name}" sent.`);
		return true;
	});
}

export async function bin(client: Client): Promise<void> {
	await registerComponentHandlers(join(baseDir, 'components'));
	await registerCommandHandlers(join(baseDir, 'commands'));
	registerMessageRelay(client);
	registerSnippetCommandResolver();

	// `.unref()` so this interval never keeps the process alive on its own — matches bot-core's
	// client.ts guild-list-sync interval, the only other recurring background loop in the codebase.
	setInterval(async () => {
		try {
			await sweepAbandonedPendingTickets(getContext().logger);
		} catch (error) {
			getContext().logger.error({ err: error }, 'Failed to sweep abandoned pending tickets');
		}
	}, PENDING_TICKET_SWEEP_INTERVAL_MS).unref();

	setInterval(async () => {
		try {
			await sweepScheduledCloses(getContext().logger);
		} catch (error) {
			getContext().logger.error({ err: error }, 'Failed to sweep scheduled ticket closes');
		}
	}, SCHEDULED_CLOSE_SWEEP_INTERVAL_MS).unref();

	await sweepThreadNukes(getContext().logger);
	setInterval(async () => {
		try {
			await sweepThreadNukes(getContext().logger);
		} catch (error) {
			getContext().logger.error({ err: error }, 'Failed to sweep scheduled thread nukes');
		}
	}, THREAD_NUKE_SWEEP_INTERVAL_MS).unref();

	// Self-rescheduling rather than `setInterval` (unlike the sweep above) since its per-run cost scales
	// with how many tickets are open rather than a small bounded table — a guild with enough concurrent
	// tickets could in principle take long enough for one run to still be going when the next tick would
	// otherwise fire, queuing duplicate GET/PATCH pairs for the same channels. Only scheduling the next
	// run once the current one settles rules that out by construction.
	const schedulePreventThreadArchiveSweep = (): void => {
		setTimeout(async () => {
			try {
				await preventOpenThreadsFromArchiving(getContext().logger);
			} catch (error) {
				getContext().logger.error({ err: error }, 'Failed to sweep open threads for auto-archive prevention');
			} finally {
				schedulePreventThreadArchiveSweep();
			}
		}, PREVENT_THREAD_ARCHIVE_INTERVAL_MS).unref();
	};

	schedulePreventThreadArchiveSweep();
}
