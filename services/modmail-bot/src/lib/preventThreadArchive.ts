import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { Threads } from '@chatsift/db';
import { DiscordAPIError } from '@discordjs/rest';

/**
 * Discord auto-archives a thread after its configured `auto_archive_duration` of inactivity,
 * regardless of whether a modmail ticket built on top of it is still open — a conversation that goes
 * quiet on both sides for long enough (mods haven't replied, user hasn't messaged back yet) can trip
 * that timer well before anyone actually closes the ticket. Run on an interval from `index.ts`'s
 * `bin()`, mirroring prod `ChatSift/ModMail`'s `preventAutoArchive` job: re-fetch every open ticket's
 * two Discord threads (mod-forum + private) and unarchive any that got caught by it, so an open
 * ticket never silently stops accepting replies out from under the people using it. Also doubles as
 * this sweep's only opportunity to notice a channel that isn't merely archived but gone outright
 * (deleted out-of-band) — see the 404 branch below — since nothing else in the bot currently re-checks
 * an open ticket's channels on any kind of interval.
 */
export async function preventOpenThreadsFromArchiving(logger: Logger): Promise<void> {
	const openThreads = await getContext().db<Threads[]>`
		SELECT * FROM threads WHERE closed_at IS NULL
	`;

	// Flattened rather than nested loops so every channel's GET (+ maybe PATCH) fires concurrently —
	// each pair is independent of every other, there's no shared state to serialize on the way
	// `pendingTicketSweep.ts` has to for its per guild+user lock.
	const checks = openThreads.flatMap((thread) =>
		[thread.modThreadId, thread.userThreadId]
			.filter((id): id is string => id !== null)
			.map((channelId) => ({ threadId: thread.id, guildId: thread.guildId, channelId })),
	);

	await Promise.all(
		checks.map(async ({ threadId, guildId, channelId }) => {
			const rowLogger = logger.child({ guildId, threadId, channelId });

			try {
				const channel = await getContext().service.client.api.channels.get(channelId);
				if ('thread_metadata' in channel && channel.thread_metadata?.archived) {
					await getContext().service.client.api.channels.edit(
						channelId,
						{ archived: false },
						{ reason: 'Keeping an open modmail ticket thread from auto-archiving' },
					);

					rowLogger.info('Unarchived an open modmail thread');
				}
			} catch (error) {
				if (!(error instanceof DiscordAPIError && error.status === 404)) {
					rowLogger.warn({ err: error }, 'Failed to unarchive an open modmail thread');
					return;
				}

				// The channel is gone for good (deleted out-of-band — neither side of a ticket is ever
				// deleted by this bot outside of an explicit close). Leaving `closed_at` null here would
				// keep this ticket counted against the user's `countActiveTicketsForUser` limit
				// (`lib/threads.ts`) forever, with no way for them to ever open a replacement — closing it
				// is the only way to make that count accurate again. `closedById` stays null: it's a
				// nullable column and there's no staff member to attribute this to, since nothing in the
				// bot's own control flow did this. Gated on `closed_at IS NULL` so the mod-forum and
				// private-thread checks for the same ticket (which can both 404 in the same sweep) don't
				// race each other into logging this twice.
				const [closed] = await getContext().db<Threads[]>`
					UPDATE threads SET closed_at = now() WHERE id = ${threadId} AND closed_at IS NULL RETURNING *
				`;

				if (closed) {
					rowLogger.warn('Closed a modmail ticket because its Discord channel no longer exists');
				}
			}
		}),
	);
}
