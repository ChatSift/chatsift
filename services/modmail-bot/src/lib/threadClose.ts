import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { GuildSettings, Threads } from '@chatsift/db';
import type { APIEmbed } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { getAnonReplyLabelTemplate, getGuildInfo } from './guild.js';
import { identityFooter, nicknameAuthor } from './relay.js';
import { templateDataFromMember, templateGuildName, templateString } from './templateString.js';
import { incrementLocalMessageId, insertThreadMessage, isRecordingEnabled } from './threads.js';

/**
 * Matches prod ChatSift/ModMail's `Colors.Red` — distinct from the relay colors (`lib/relay.ts`) and
 * the opening/greeting `NOT_QUITE_BLACK` (`lib/ticketCreation.ts`), so a closed ticket reads visually
 * distinct from every other kind of post in the thread.
 */
const CLOSE_RED = 0xed_42_45;

export interface CloseThreadOptions {
	/**
	 * Whether the farewell message should show the guild-team label instead of `closedById`'s real
	 * identity — mirrors `/reply`/`/reply-q`'s `anon` option exactly, including the `false` (attributed)
	 * default. Matches `/close`'s and `scheduled_thread_closes`' `anon` flag.
	 */
	anon: boolean;
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
 * locks the user's private thread. Deletion of that private thread is opt-in and, when enabled via
 * `guild_settings.nuke_delay_minutes`, not immediate — a `scheduled_thread_nukes` row is written
 * instead so `lib/threadNukeSweep.ts` deletes it once the delay has passed, giving staff a window to
 * still glance at it before it's actually gone. When left disabled (the default), the thread is simply
 * left locked; it eventually falls out of the channel list on its own once Discord's own inactivity
 * auto-archive catches it. Shared by `/close`
 * (immediate) and the scheduled-close sweep (`lib/scheduledCloseSweep.ts`) so both paths close a
 * ticket identically. Returns `false` without doing anything further if the thread was already closed
 * by the time this runs (e.g. a manual `/close` racing the sweep for the same scheduled ticket) — the
 * `closed_at IS NULL` guard below is what makes that race safe: only one caller ever gets a row back.
 */
export async function closeThread({ anon, closedById, logger, silent, thread }: CloseThreadOptions): Promise<boolean> {
	// Cleared regardless of who's closing this — a manual `/close` on a ticket that also has a pending
	// scheduled close must not leave that schedule around to fire a second, redundant close later.
	await getContext().db`DELETE FROM scheduled_thread_closes WHERE thread_id = ${thread.id}`;

	const [closed] = await getContext().db<Threads[]>`
		UPDATE threads SET closed_at = now(), closed_by_id = ${closedById} WHERE id = ${thread.id} AND closed_at IS NULL RETURNING *
	`;

	if (!closed) {
		return false;
	}

	if (thread.userChannelId) {
		const [guildSettings] = await getContext().db<[Pick<GuildSettings, 'farewellMessage' | 'nukeDelayMinutes'>?]>`
			SELECT farewell_message, nuke_delay_minutes FROM guild_settings WHERE guild_id = ${thread.guildId}
		`;

		// Posted before the "Ticket closed by" log below — mods should see what the user was actually
		// told before the log entry announcing the closure itself, not after.
		if (!silent && guildSettings?.farewellMessage) {
			await postFarewellMessage(thread, guildSettings.farewellMessage, anon, closedById, logger);
		}

		try {
			// Locked but deliberately *not* archived, unlike the mod-forum thread below — archiving a
			// user's private thread drops it out of their channel list with no obvious reason why, which
			// just reads as "it disappeared". Locked-but-unarchived keeps it visible (read-only) until the
			// scheduled nuke actually deletes it, so the user can see it's closed rather than guessing.
			await getContext().service.client.api.channels.edit(
				thread.userChannelId,
				{ locked: true },
				{ reason: 'ModMail ticket closed' },
			);
		} catch (error) {
			if (!(error instanceof DiscordAPIError && error.status === 404)) {
				logger.warn({ err: error, threadId: thread.id }, 'Failed to lock the user private thread on close');
			}
		}

		const nukeDelayMinutes = guildSettings?.nukeDelayMinutes ?? null;
		if (nukeDelayMinutes === null) {
			// Deletion is opt-in (`guild_settings.nuke_delay_minutes` defaults to NULL) -- if a guild
			// disabled it after an earlier close already scheduled a nuke for this same thread (re-closing
			// via the scheduled-close sweep race described above), that stale row must not survive to fire
			// later once the setting no longer says to.
			await getContext().db`DELETE FROM scheduled_thread_nukes WHERE thread_id = ${thread.id}`;
		} else {
			const nukeAt = new Date(Date.now() + nukeDelayMinutes * 60_000);
			await getContext().db`
				INSERT INTO scheduled_thread_nukes (thread_id, nuke_at) VALUES (${thread.id}, ${nukeAt})
				ON CONFLICT (thread_id) DO UPDATE SET nuke_at = EXCLUDED.nuke_at
			`;
		}
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
async function postFarewellMessage(
	thread: Threads,
	farewellMessage: string,
	anon: boolean,
	closedById: string,
	logger: Logger,
): Promise<void> {
	if (!thread.userChannelId) {
		return;
	}

	try {
		const guild = await getGuildInfo(thread.guildId);

		let content: string;
		let closer;
		try {
			// Same account both as the ticket opener (for content templating below) and, separately, as
			// `closedById` when someone closes their own test ticket — two independent lookups regardless,
			// since either can fail on its own.
			closer = await getContext().service.client.api.guilds.getMember(thread.guildId, closedById);
		} catch (error) {
			// Only a confirmed-gone member (404, "Unknown Member") should anonymize/degrade the audit
			// footer below — anything else (rate limit, network blip, transient 5xx) is a real failure
			// that shouldn't silently override an explicit `anon: false` or blank out a still-valid
			// identity, so it propagates to the outer catch instead (same distinction the private-thread
			// lock edit above makes for its own 404 case).
			if (!(error instanceof DiscordAPIError && error.status === 404)) {
				throw error;
			}

			closer = undefined;
		}

		try {
			// Mirrors `sendGreeting` (`lib/ticketCreation.ts`): full template data (join date, username, etc)
			// when the member is still resolvable, falling back to just `{{ guildName }}` (matches the anon
			// reply label precedent) when they've since left the guild.
			const member = await getContext().service.client.api.guilds.getMember(thread.guildId, thread.userId);
			content = templateString(farewellMessage, templateDataFromMember(guild.name, member, member.user));
		} catch {
			content = templateGuildName(farewellMessage, guild.name);
		}

		// Same attributed-vs-anon split as staff replies (`relayStaffReplyToUserThread`, `lib/relay.ts`):
		// attributed (the default) shows the closing staffer's real nickname/identity as the "sent as"
		// author on both copies; anon shows the "{{ guildName }} Team" label instead. Also falls back to
		// anon if the closer can no longer be resolved as a guild member (e.g. they've since left —
		// plausible for a delayed scheduled close).
		let author: ReturnType<typeof nicknameAuthor>;
		let userFooter: { icon_url?: string; text: string };
		if (anon || !closer) {
			const labelTemplate = await getAnonReplyLabelTemplate(thread.guildId);
			const label = templateGuildName(labelTemplate, guild.name);
			author = guild.iconURL ? { name: label, icon_url: guild.iconURL } : { name: label };
			userFooter = guild.iconURL ? { text: label, icon_url: guild.iconURL } : { text: label };
		} else {
			author = nicknameAuthor(thread.guildId, closer, closer.user);
			userFooter = identityFooter(closer.user);
		}

		// User-facing copy, into the private thread.
		const userMessage = await getContext().service.client.api.channels.createMessage(thread.userChannelId, {
			embeds: [
				{
					color: CLOSE_RED,
					description: content,
					...(author ? { author } : {}),
					footer: userFooter,
				},
			],
		});

		// Mod-forum log copy — always shows the real closer identity in its footer regardless of `anon`,
		// same as `relayStaffReplyToUserThread`'s `logEmbed`: staff never lose the audit trail just
		// because the user-facing copy was anonymized. Posted before the "Ticket closed by" log embed
		// (see `closeThread`) so mods see what the user was told before the closure announcement itself.
		const modMessage = await getContext().service.client.api.channels.createMessage(thread.modThreadId, {
			embeds: [
				{
					color: CLOSE_RED,
					description: content,
					...(author ? { author } : {}),
					footer: closer ? identityFooter(closer.user) : { text: `Unknown user (${closedById})` },
				},
			],
		});

		// Recorded the same way a staff reply is (Phase 3, #261) -- `is_system` distinguishes it from a
		// real staff/user message on read (see schema.sql's own doc comment). `staffId` is still populated
		// when attributed (matches the mod-forum log's own "always show the real closer" behavior above),
		// `null` for an anonymized farewell or an unresolvable closer -- there's no real actor to name in
		// either case. Only inserted when recording is enabled, same as internal mod-chatter.
		if (await isRecordingEnabled(thread.guildId)) {
			const localThreadMessageId = await incrementLocalMessageId(thread.id);
			await insertThreadMessage({
				anon,
				content: {
					attachments: [],
					isForwarded: false,
					repliedToThreadMessageId: null,
					stickers: [],
					text: content,
				},
				guildId: thread.guildId,
				guildMessageId: modMessage.id,
				isSystem: true,
				localThreadMessageId,
				staffId: anon || !closer ? null : closedById,
				threadId: thread.id,
				userId: thread.userId,
				userMessageId: userMessage.id,
			});
		}
	} catch (error) {
		logger.warn({ err: error, threadId: thread.id }, 'Failed to post the farewell message before closing');
	}
}
