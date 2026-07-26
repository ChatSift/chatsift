import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { ScheduledThreadNukes, Threads } from '@chatsift/db';
import { DiscordAPIError } from '@discordjs/rest';

/**
 * Run on an interval from `index.ts`'s `bin()`. `closeThread` (`lib/threadClose.ts`) locks a ticket's
 * private thread immediately on close but leaves the actual deletion for later — this is what acts on
 * `scheduled_thread_nukes.nuke_at` lapsing and deletes the channel for real.
 */
export async function sweepThreadNukes(logger: Logger): Promise<void> {
	const due = await getContext().db<(Pick<Threads, 'guildId' | 'userThreadId'> & ScheduledThreadNukes)[]>`
		SELECT sn.thread_id, sn.nuke_at, t.user_thread_id, t.guild_id
		FROM scheduled_thread_nukes sn
		INNER JOIN threads t ON t.id = sn.thread_id
		WHERE sn.nuke_at <= now()
	`;

	await Promise.all(
		due.map(async (row) => {
			const rowLogger = logger.child({ guildId: row.guildId, threadId: row.threadId });

			try {
				if (row.userThreadId) {
					try {
						await getContext().service.client.api.channels.delete(row.userThreadId, {
							reason: 'Scheduled ModMail private thread deletion',
						});
					} catch (error) {
						if (!(error instanceof DiscordAPIError && error.status === 404)) {
							throw error;
						}
					}
				}

				await getContext().db`DELETE FROM scheduled_thread_nukes WHERE thread_id = ${row.threadId}`;
				rowLogger.info('Nuked a closed modmail ticket private thread');
			} catch (error) {
				rowLogger.error({ err: error }, 'Failed to nuke a closed ticket private thread');
			}
		}),
	);
}
