import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { Categories, GuildSettings, TicketPanels } from '@chatsift/db';
import type { APIInteractionGuildMember, APIMessageComponentInteraction } from '@discordjs/core';
import { ChannelType } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { PendingTicketStore, recordPendingTicket } from './pendingTicket.js';
import { countOpenThreadsForUserInCategory, MAX_THREAD_AUTO_ARCHIVE_DURATION_MINUTES } from './threads.js';
import { sendEarlyGreeting } from './ticketCreation.js';

export interface CreatePanelTicketOptions {
	/**
	 * Already resolved by the caller -- picked from the select (`components/categorySelect.ts`), the
	 * panel's only category (`components/createTicket.ts`, which skips the picker in that case), or
	 * `null` for a panel with no categories at all.
	 */
	category: Categories | null;
	guildId: string;
	guildSettings: GuildSettings;
	/**
	 * Already deferred by the caller -- a plain `defer` for the button (`createTicket.ts`), a
	 * `deferMessageUpdate` for the select (`categorySelect.ts`) -- so every outcome below resolves it via
	 * `editReply`. `components: []` is what clears the picker itself when this ran off a select; it's a
	 * no-op for the button's own freshly deferred response, which never had any.
	 */
	interaction: APIMessageComponentInteraction;
	logger: Logger;
	member: APIInteractionGuildMember;
	panel: TicketPanels;
}

/**
 * The tail every panel-flow ticket goes through once its category (if any) is settled: the
 * per-category concurrency check, the private thread itself, and the pending-ticket bookkeeping that
 * bridges to `index.ts`'s first-message handler.
 *
 * Shared because there are three ways to reach it -- a zero-category panel and a single-category panel
 * (both straight from `components/createTicket.ts`, no picker shown) and an actual pick landing in
 * `components/categorySelect.ts`. The guild-wide checks that run *before* this (block, guild config,
 * `countActiveTicketsForUser`) deliberately stay at the call sites: `createTicket.ts` runs them as a
 * fast pre-check before even showing a picker, and `categorySelect.ts` re-runs them authoritatively
 * once a pick lands, so they can't collapse into one shared call the way this tail can.
 */
export async function createPanelTicket({
	category,
	guildId,
	guildSettings,
	interaction,
	logger,
	member,
	panel,
}: CreatePanelTicketOptions): Promise<void> {
	const user = member.user;

	const editReply = async (content: string) => {
		await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
			content,
			components: [],
		});
	};

	if (category) {
		// `category.maxConcurrentThreads` is nullable ("inherit the guild's general limit") and is
		// clamped to the guild's current value regardless -- see git history for the write-side/read-side
		// split this defends against.
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
			await editReply('The bot is missing permissions to create a ticket thread here. Please let a moderator know.');
			return;
		}

		throw error;
	}

	await getContext().service.client.api.threads.addMember(privateThread.id, user.id);

	// Nothing is sent to staff yet -- the mod-forum thread only gets created once the user's first
	// message arrives, caught by `index.ts`'s `MessageCreate` listener via this pending-ticket record.
	//
	// The greeting is the one exception to "nothing posted into the thread yet": when
	// `greetingBeforeOpener` is on, it has to go out now, before the user says anything, since that's the
	// only point at which the bot can actually land ahead of their first message (see `sendEarlyGreeting`'s
	// doc comment). Best-effort -- a failure here shouldn't block ticket creation, it just means the
	// greeting falls back to landing after the opener at finish time, same as `greetingBeforeOpener` being
	// off.
	let greetingUserMessageId: string | null = null;
	if (guildSettings.greetingBeforeOpener) {
		try {
			greetingUserMessageId = await sendEarlyGreeting({
				category,
				defaultGreetingMessage: guildSettings.defaultGreetingMessage,
				guildId,
				member,
				user,
				userChannelId: privateThread.id,
			});
		} catch (error) {
			logger.warn({ err: error, threadId: privateThread.id }, 'Failed to send the early greeting message');
		}
	}

	await Promise.all([
		PendingTicketStore.set(privateThread.id, {
			// `0` is the "no category" sentinel here, never a real id -- see `PendingTicketState.categoryId`.
			categoryId: category?.id ?? 0,
			greetingUserMessageId,
			guildId,
			userId: user.id,
		}),
		recordPendingTicket({
			categoryId: category?.id ?? null,
			guildId,
			privateThreadId: privateThread.id,
			userId: user.id,
		}),
	]);

	await editReply(
		`Your ticket has been created: <#${privateThread.id}>. Describe what you need help with there - a staff member will follow up once you send your message.`,
	);
}
