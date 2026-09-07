import type { Logger } from '@chatsift/backend-core';
import { getContext, readGuildList } from '@chatsift/backend-core';
import { ownsShardForGuild } from '@chatsift/bot-core';
import type { ScheduledThreadNukes, Threads } from '@chatsift/db';
import { DiscordAPIError } from '@discordjs/rest';
import { getGuildListKey, getOwnershipScope } from './instance.js';
import { sweepLag, threadNukeDeferrals } from './metrics.js';

/**
 * How far a due nuke is pushed out when Discord refuses the delete for lack of permissions. Nothing about
 * that failure resolves on its own -- until someone gives the bot `ManageThreads` back in the panel's
 * channel every retry is a guaranteed 403, so retrying at the sweep's own cadence turns one misconfigured
 * guild into a permanent request (and error log line) per minute for as long as the row exists. An hour is
 * long enough for that to round to nothing, and short enough that restoring the permission takes effect
 * without anyone having to touch the ticket again.
 */
const PERMISSION_RETRY_DELAY_MS = 60 * 60 * 1_000;

/**
 * Run on an interval from `index.ts`'s `bin()`. `closeThread` (`lib/threadClose.ts`) locks a ticket's
 * private thread immediately on close but leaves the actual deletion for later -- this is what acts on
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

	// Same leak #370 fixed in `lib/preventThreadArchive.ts`: a guild that removed the bot answers every
	// channel request with 403 rather than 404, so these rows never reach the terminal branch below and
	// cost one guaranteed-403 request each on every single run, forever. The guild set the gateway already
	// maintains in redis answers that without paying for a Discord call to find out.
	const presentGuildIds = new Set(await readGuildList(getGuildListKey()));

	// Fails closed: an empty set with rows to sweep means the list expired underneath us, not that the bot
	// is in no guilds. Absence is only ever used to *skip* a row, never to delete one -- a nuke that can't
	// run today still has to run if the bot is added back tomorrow.
	if (presentGuildIds.size === 0 && due.length > 0) {
		logger.warn('No guild list to check scheduled thread nukes against, skipping the nuke sweep this run');
		return;
	}

	await Promise.all(
		due
			.filter((row) => ownsShardForGuild(row.guildId) && presentGuildIds.has(row.guildId))
			.map(async (row) => {
				const rowLogger = logger.child({ guildId: row.guildId, threadId: row.threadId });

				sweepLag.observe({ sweep: 'thread_nuke' }, Math.max(0, (Date.now() - row.nukeAt.getTime()) / 1_000));

				try {
					if (row.userChannelId) {
						try {
							await getContext().service.client.api.channels.delete(row.userChannelId, {
								reason: 'Scheduled ModMail private thread deletion',
							});
						} catch (error) {
							if (error instanceof DiscordAPIError && error.status === 403) {
								// Reached only for a guild the bot *is* still in (the filter above took the other case),
								// so this is a live permissions problem someone can fix -- the bot lost `ManageThreads` in
								// the panel's channel, which is what deleting a private thread it created needs. Not
								// terminal the way a 404 is: the schedule stays, it just backs off. Pushing `nuke_at` out
								// *is* the retry mechanism, so there is no attempt counter to keep anywhere.
								const retryAt = new Date(Date.now() + PERMISSION_RETRY_DELAY_MS);
								await getContext().db`
									UPDATE scheduled_thread_nukes SET nuke_at = ${retryAt} WHERE thread_id = ${row.threadId}
								`;

								threadNukeDeferrals.inc();
								// `channelId` spelled out rather than left to the error's own request URL: this is the one
								// line that says *which* thread a guild has to grant `ManageThreads` over, and its parent
								// channel (the panel's, which is where the permission actually lives) is one lookup away
								// from it. `lib/botPermissions.ts` warns about the same gap at ticket-open time.
								rowLogger.warn(
									{ err: error, channelId: row.userChannelId },
									'Missing permissions to delete a closed ticket private thread, retrying in an hour',
								);
								return;
							}

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
