import type { Logger } from '@chatsift/backend-core';
import { getContext, readGuildList } from '@chatsift/backend-core';
import { ownsShardForGuild } from '@chatsift/bot-core';
import type { Threads } from '@chatsift/db';
import { DiscordAPIError } from '@discordjs/rest';
import { getGuildListKey, getOwnershipScope } from './instance.js';
import { strandedOpenTickets, ticketsClosed } from './metrics.js';

/**
 * Discord auto-archives a thread after its configured `auto_archive_duration` of inactivity,
 * regardless of whether a modmail ticket built on top of it is still open — a conversation that goes
 * quiet on both sides for long enough (mods haven't replied, user hasn't messaged back yet) can trip
 * that timer well before anyone actually closes the ticket. Run on an interval from `index.ts`'s
 * `bin()`: re-fetch every open ticket's two Discord threads (mod-forum + private) and unarchive any
 * that got caught by it, so an open ticket never silently stops accepting replies out from under the
 * people using it. Also doubles as
 * this sweep's only opportunity to notice a channel that isn't merely archived but gone outright
 * (deleted out-of-band) — see the 404 branch below — since nothing else in the bot currently re-checks
 * an open ticket's channels on any kind of interval.
 */
export async function preventOpenThreadsFromArchiving(logger: Logger): Promise<void> {
	// See docs/roadmap/01-architecture.md §8 -- unarchiving (or closing, in the 404 branch
	// below) a thread in a guild this deployment doesn't own would race whichever deployment does.
	const scope = getOwnershipScope();

	// `origin != 'dm'` -- a DM-origin ticket's `user_channel_id` is a plain DM channel, never a Discord
	// thread, so `channels.get` on it below would never find `thread_metadata` to unarchive in the
	// first place. Filtered out here rather than discovered per-row from the Discord response, since
	// `origin` is already known without an API call (#216, P4).
	const openThreads = await getContext().db<Threads[]>`
		SELECT * FROM threads WHERE closed_at IS NULL AND origin != 'dm'
			AND ${scope.kind === 'only' ? getContext().db`guild_id = ${scope.guildId}` : getContext().db`guild_id != ALL(${scope.excludedGuildIds})`}
	`;

	// #370: a guild that removes the bot leaves its open tickets behind, and nothing ever closes them --
	// Discord answers `GET /channels/{id}` for a guild the bot isn't in with **403 Missing Access**, not
	// 404, so the terminal branch below never fires and every one of those rows costs two guaranteed-403
	// requests on every single run, forever. Filtering against the guild set the gateway already
	// maintains in redis costs no Discord call at all, which is what makes it worth doing here rather
	// than reacting to the 403 after paying for it.
	const presentGuildIds = new Set(await readGuildList(getGuildListKey()));

	// An empty set with rows to sweep means the guild list is unavailable (expired underneath us, redis
	// wiped), not that the bot is in no guilds -- and this filter fails *closed*, so acting on it would
	// skip every ticket there is. Skipping the run outright is the same outcome, but says so.
	if (presentGuildIds.size === 0 && openThreads.length > 0) {
		logger.warn('No guild list to check open tickets against, skipping the auto-archive sweep this run');
		return;
	}

	// Both filters, and the gauge, are scoped to this replica's own shard slice -- every replica sweeps the
	// same `threads` table, so counting the stranded rows before narrowing to what this process is
	// responsible for would have each replica report the whole fleet's number and `sum()` multiply it.
	const owned = openThreads.filter((thread) => ownsShardForGuild(thread.guildId));
	const present = owned.filter((thread) => presentGuildIds.has(thread.guildId));
	strandedOpenTickets.set(owned.length - present.length);

	// Flattened rather than nested loops so every channel's GET (+ maybe PATCH) fires concurrently —
	// each pair is independent of every other, there's no shared state to serialize on the way
	// `pendingTicketSweep.ts` has to for its per guild+user lock.
	const checks = present.flatMap((thread) =>
		[thread.modThreadId, thread.userChannelId]
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
				if (error instanceof DiscordAPIError && error.status === 403) {
					// Reached only for a guild the bot *is* still in (the filter above took the other case),
					// so this is a live permissions problem someone can actually fix: the bot lost
					// `ViewChannel` on the thread's parent, or lost `ManageThreads` on a locked one. Not
					// terminal the way a 404 is -- the ticket stays open, because restoring the permission is
					// all it takes for the next run to pick up exactly where this one left off. This is the
					// failure `lib/botPermissions.ts` warns about in the mod thread at open time (#370), so by
					// the time it shows up here the guild has already been told once.
					rowLogger.warn(
						{ err: error },
						'Missing permissions to keep an open modmail thread unarchived, leaving the ticket open',
					);
					return;
				}

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
					ticketsClosed.inc({ source: 'auto_archive', result: 'closed' });
					rowLogger.warn('Closed a modmail ticket because its Discord channel no longer exists');
				} else {
					ticketsClosed.inc({ source: 'auto_archive', result: 'already_closed' });
				}
			}
		}),
	);
}
