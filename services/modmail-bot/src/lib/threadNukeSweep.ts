import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { ownsShardForGuild } from '@chatsift/bot-core';
import type { ScheduledThreadNukes, Threads } from '@chatsift/db';
import { DiscordAPIError } from '@discordjs/rest';
import { getOwnershipScope } from './instance.js';

/**
 * Run on an interval from `index.ts`'s `bin()`. `closeThread` (`lib/threadClose.ts`) locks a ticket's
 * private thread immediately on close but leaves the actual deletion for later — this is what acts on
 * `scheduled_thread_nukes.nuke_at` lapsing and deletes the channel for real.
 */
export async function sweepThreadNukes(logger: Logger): Promise<void> {
	// See docs/roadmap/01-architecture.md §8 -- deleting a private thread in a guild this
	// deployment doesn't own would race whichever deployment does.
	const scope = getOwnershipScope();

	const due = await getContext().db<(Pick<Threads, 'guildId' | 'userChannelId'> & ScheduledThreadNukes)[]>`
		SELECT sn.thread_id, sn.nuke_at, t.user_channel_id, t.guild_id
		FROM scheduled_thread_nukes sn
		INNER JOIN threads t ON t.id = sn.thread_id
		WHERE sn.nuke_at <= now()
			AND ${scope.kind === 'only' ? getContext().db`t.guild_id = ${scope.guildId}` : getContext().db`t.guild_id != ALL(${scope.excludedGuildIds})`}
	`;

	await Promise.all(
		due
			.filter((row) => ownsShardForGuild(row.guildId))
			.map(async (row) => {
				const rowLogger = logger.child({ guildId: row.guildId, threadId: row.threadId });

				try {
					if (row.userChannelId) {
						try {
							await getContext().service.client.api.channels.delete(row.userChannelId, {
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
