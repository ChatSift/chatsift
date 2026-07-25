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
 * ticket never silently stops accepting replies out from under the people using it.
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
			.map((channelId) => ({ threadId: thread.id, channelId })),
	);

	await Promise.all(
		checks.map(async ({ threadId, channelId }) => {
			try {
				const channel = await getContext().service.client.api.channels.get(channelId);
				if ('thread_metadata' in channel && channel.thread_metadata?.archived) {
					await getContext().service.client.api.channels.edit(
						channelId,
						{ archived: false },
						{ reason: 'Keeping an open modmail ticket thread from auto-archiving' },
					);

					logger.info({ threadId, channelId }, 'Unarchived an open modmail thread');
				}
			} catch (error) {
				// A 404 just means the channel is already gone (e.g. deleted manually, or — once closing a
				// ticket deletes the private thread — a close racing this sweep) — not worth logging as a
				// failure.
				if (!(error instanceof DiscordAPIError && error.status === 404)) {
					logger.warn({ err: error, threadId, channelId }, 'Failed to unarchive an open modmail thread');
				}
			}
		}),
	);
}
