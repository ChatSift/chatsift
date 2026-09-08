import { setInterval } from 'node:timers';
import { getContext, syncShardGuildList } from '@chatsift/backend-core';
import { discordAPIAppeals } from './discordAPI.js';

/**
 * Deliberately under the 60s TTL `syncShardGuildList` arms each slice with, not equal to it. At 60s the poll
 * races its own expiry: `readGuildList` reaps the slice a moment before the next tick re-arms it, and the
 * dashboard flickers Appeals in and out of every guild's badge row. Half the TTL means a single failed poll
 * costs nothing at all.
 */
const POLL_INTERVAL_MS = 30_000;

/**
 * Discord's ceiling on `GET /users/@me/guilds`.
 */
const PAGE_SIZE = 200;

/**
 * The Appeals bot has no shards, so one slice is the whole deployment and every API replica publishes the same
 * full list into the same synthetic index. That is idempotent by construction -- each poll reports everything
 * the bot is in, so two replicas agreeing is a no-op rather than a conflict.
 *
 * It is also why nothing drops the slice on shutdown, unlike `bot-core`'s gateway clients: `dropGuildList` is
 * keyed on the index alone, so one replica exiting would yank the slice out from under every sibling still
 * serving traffic. The 60s TTL is the correct reaper here -- and by the time it matters, the process that was
 * answering dashboard requests is gone anyway.
 */
const REPLICA_INDEX = 0;

let pollTimer: NodeJS.Timeout | null = null;

/**
 * Every guild the Appeals bot is in, paginated. Bots may call this endpoint and it is authoritative for both
 * additions and removals, which is what lets a poll stand in for the GUILD_CREATE/GUILD_DELETE stream an
 * HTTP-only bot never receives.
 */
async function fetchGuildIds(): Promise<string[]> {
	const guildIds: string[] = [];
	let after: string | undefined;

	for (;;) {
		// Spread rather than `{ after, limit }`: `exactOptionalPropertyTypes` refuses an explicit `undefined`
		// for an optional property, and the first page genuinely has no cursor.
		const page = await discordAPIAppeals.users.getGuilds({
			limit: PAGE_SIZE,
			...(after === undefined ? {} : { after }),
		});
		for (const guild of page) {
			guildIds.push(guild.id);
		}

		if (page.length < PAGE_SIZE) {
			return guildIds;
		}

		after = page.at(-1)!.id;
	}
}

async function poll(): Promise<void> {
	// `clearable: () => true` because this poll sees the entire deployment: anything in the slice that the
	// poll didn't report is a guild the bot was removed from, with no sibling shard that could still own it.
	await syncShardGuildList('APPEALS', REPLICA_INDEX, await fetchGuildIds(), () => true);
}

/**
 * Publishes the Appeals bot's guild list (#232, docs/roadmap/09-appeals.md §2) so `me.ts` reports `APPEALS` in
 * a guild's `bots` and the dashboard renders the section for it.
 *
 * This is the one thing that does not come for free once the gateway is dropped, and it is load-bearing:
 * without it the feature is invisible in every guild that has it installed. Call once at boot, after
 * `initContext()`.
 *
 * The first poll runs inline so presence is up before the server starts answering, but a failure is logged
 * rather than fatal -- the interval is the mechanism, and refusing to boot the whole API over one bad Discord
 * response would take the dashboard down with it.
 */
export async function startAppealsPresence(): Promise<void> {
	const { logger } = getContext();

	try {
		await poll();
	} catch (error) {
		logger.error({ err: error }, 'initial Appeals guild list poll failed');
	}

	pollTimer ??= setInterval(async () => {
		try {
			await poll();
		} catch (error) {
			logger.error({ err: error }, 'Appeals guild list poll failed');
		}
	}, POLL_INTERVAL_MS).unref();
}
