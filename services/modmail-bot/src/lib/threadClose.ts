import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { GuildSettings, Threads } from '@chatsift/db';
import type { APIEmbed } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { getAnonReplyLabelTemplate, getGuildInfo } from './guild.js';
import { templateDataFromMember, templateGuildName, templateString } from './templateString.js';

/**
 * Matches prod ChatSift/ModMail's `Colors.Red` — distinct from the relay colors (`lib/relay.ts`) and
 * the opening/greeting `NOT_QUITE_BLACK` (`lib/ticketCreation.ts`), so a closed ticket reads visually
 * distinct from every other kind of post in the thread.
 */
const CLOSE_RED = 0xed_42_45;

export interface CloseThreadOptions {
	/**
	 * The staff member who ran `/close`, or the id that scheduled it (`scheduled_thread_closes.scheduled_by_id`)
	 * when this fires from the sweep instead.
	 */
	closedById: string;
	logger: Logger;
	/**
	 * Skips the farewell message posted into the user's private thread before it's deleted — the mod-forum
	 * log message and the "nuke" itself still always happen. Matches `/close`'s and `scheduled_thread_closes`'
	 * `silent` flag.
	 */
	silent: boolean;
	thread: Threads;
}

/**
 * Closes a ModMail ticket: archives + locks the mod-forum thread (kept as the durable staff-side
 * record per the redesign, see `docs/roadmap/06-modmail-port.md` §"new create-flow" step 6) and
 * locks the user's private thread — it isn't deleted right away; a `scheduled_thread_nukes` row is
 * written instead so `lib/threadNukeSweep.ts` deletes it once `guild_settings.nuke_delay_minutes` has
 * passed, giving staff a window to still glance at it before it's actually gone. Shared by `/close`
 * (immediate) and the scheduled-close sweep (`lib/scheduledCloseSweep.ts`) so both paths close a
 * ticket identically. Returns `false` without doing anything further if the thread was already closed
 * by the time this runs (e.g. a manual `/close` racing the sweep for the same scheduled ticket) — the
 * `closed_at IS NULL` guard below is what makes that race safe: only one caller ever gets a row back.
 */
export async function closeThread({ closedById, logger, silent, thread }: CloseThreadOptions): Promise<boolean> {
	// Cleared regardless of who's closing this — a manual `/close` on a ticket that also has a pending
	// scheduled close must not leave that schedule around to fire a second, redundant close later.
	await getContext().db`DELETE FROM scheduled_thread_closes WHERE thread_id = ${thread.id}`;

	const [closed] = await getContext().db<Threads[]>`
		UPDATE threads SET closed_at = now(), closed_by_id = ${closedById} WHERE id = ${thread.id} AND closed_at IS NULL RETURNING *
	`;

	if (!closed) {
		return false;
	}

	const closedEmbed: APIEmbed = {
		color: CLOSE_RED,
		description: `🔒 Ticket closed by <@${closedById}>.`,
		timestamp: new Date().toISOString(),
	};

	await getContext()
		.service.client.api.channels.createMessage(thread.modThreadId, { embeds: [closedEmbed] })
		.catch((error: unknown) => {
			logger.warn({ err: error, threadId: thread.id }, 'Failed to post the closing message to the mod thread');
		});

	if (thread.userThreadId) {
		const [guildSettings] = await getContext().db<[Pick<GuildSettings, 'farewellMessage' | 'nukeDelayMinutes'>?]>`
			SELECT farewell_message, nuke_delay_minutes FROM guild_settings WHERE guild_id = ${thread.guildId}
		`;

		if (!silent && guildSettings?.farewellMessage) {
			await postFarewellMessage(thread, guildSettings.farewellMessage, logger);
		}

		try {
			// Locked but deliberately *not* archived, unlike the mod-forum thread below — archiving a
			// user's private thread drops it out of their channel list with no obvious reason why, which
			// just reads as "it disappeared". Locked-but-unarchived keeps it visible (read-only) until the
			// scheduled nuke actually deletes it, so the user can see it's closed rather than guessing.
			await getContext().service.client.api.channels.edit(
				thread.userThreadId,
				{ locked: true },
				{ reason: 'ModMail ticket closed' },
			);
		} catch (error) {
			if (!(error instanceof DiscordAPIError && error.status === 404)) {
				logger.warn({ err: error, threadId: thread.id }, 'Failed to lock the user private thread on close');
			}
		}

		const nukeDelayMinutes = guildSettings?.nukeDelayMinutes ?? 30;
		const nukeAt = new Date(Date.now() + nukeDelayMinutes * 60_000);
		await getContext().db`
			INSERT INTO scheduled_thread_nukes (thread_id, nuke_at) VALUES (${thread.id}, ${nukeAt})
			ON CONFLICT (thread_id) DO UPDATE SET nuke_at = EXCLUDED.nuke_at
		`;
	}

	try {
		await getContext().service.client.api.channels.edit(
			thread.modThreadId,
			{ archived: true, locked: true },
			{ reason: 'ModMail ticket closed' },
		);
	} catch (error) {
		logger.warn({ err: error, threadId: thread.id }, 'Failed to archive the mod-forum thread on close');
	}

	logger.info({ threadId: thread.id, closedById, silent }, 'Closed a modmail ticket');
	return true;
}

/**
 * Best-effort — posted right before the private thread is locked, so failures here (the user having
 * left the guild, the message send itself failing) should never block the actual close.
 */
async function postFarewellMessage(thread: Threads, farewellMessage: string, logger: Logger): Promise<void> {
	if (!thread.userThreadId) {
		return;
	}

	try {
		const [guild, labelTemplate] = await Promise.all([
			getGuildInfo(thread.guildId),
			getAnonReplyLabelTemplate(thread.guildId),
		]);
		const label = templateGuildName(labelTemplate, guild.name);

		let content: string;
		try {
			// Mirrors `sendGreeting` (`lib/ticketCreation.ts`): full template data (join date, username, etc)
			// when the member is still resolvable, falling back to just `{{ guildName }}` (matches the anon
			// reply label precedent) when they've since left the guild.
			const member = await getContext().service.client.api.guilds.getMember(thread.guildId, thread.userId);
			content = templateString(farewellMessage, templateDataFromMember(guild.name, member, member.user));
		} catch {
			content = templateGuildName(farewellMessage, guild.name);
		}

		// Same "{{ guildName }} Team" identity footer as the greeting (`sendGreeting`) and anon replies
		// (`lib/relay.ts`) — the farewell is just as automated/on-behalf-of-staff as those, so it should
		// read the same way rather than as an anonymous, unattributed embed.
		await getContext().service.client.api.channels.createMessage(thread.userThreadId, {
			embeds: [
				{
					color: CLOSE_RED,
					description: content,
					footer: guild.iconURL ? { text: label, icon_url: guild.iconURL } : { text: label },
				},
			],
		});
	} catch (error) {
		logger.warn({ err: error, threadId: thread.id }, 'Failed to post the farewell message before closing');
	}
}
