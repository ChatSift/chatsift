import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { AppealBanChecks } from '@chatsift/db';
import type { Snowflake } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { discordAPIAppeals } from './discordAPI.js';

/**
 * How long a guild the Appeals bot cannot read bans in stays written off (#232, docs/roadmap/09-appeals.md §4).
 *
 * The point is that a misconfigured guild costs one `403` rather than one per appellant forever -- `403`, like
 * `401` and `429`, counts toward Discord's 10,000-per-10-minutes Cloudflare ban, so a guild that invited the
 * bot without `BAN_MEMBERS` is otherwise a slow leak against a budget shared with every other ChatSift bot.
 *
 * Much longer than `guildDataCache.ts`'s 30-second negative TTL, because the two are recovering from different
 * things: that one waits out a bot being re-invited, which can happen in seconds, while this waits out a
 * moderator noticing a permission is missing and fixing it. Five minutes still means a fix takes effect while
 * they are still looking at the screen.
 */
const PROBE_BLOCKED_TTL_MS = 5 * 60 * 1_000;

const probeBlockedKey = (guildId: Snowflake): string => `appeals:probeblocked:${guildId}`;

export interface AppealBanProbe {
	/**
	 * The ban reason as Discord has it, for the record (`appeals.reason_snapshot`) and for P8's pattern
	 * matching. `null` both when the user isn't banned and when the ban carries no reason, which is the common
	 * case for one issued from the client UI.
	 */
	banReason: string | null;
	banned: boolean;
}

async function recordBanCheck(userId: Snowflake, guildId: Snowflake, probe: AppealBanProbe): Promise<void> {
	await getContext().db`
		INSERT INTO appeal_ban_checks (user_id, guild_id, banned, ban_reason)
		VALUES (${userId}, ${guildId}, ${probe.banned}, ${probe.banReason})
		ON CONFLICT (user_id, guild_id) DO UPDATE SET
			banned = EXCLUDED.banned,
			ban_reason = EXCLUDED.ban_reason,
			checked_at = now()
	`;
}

/**
 * Whether `userId` is banned in `guildId`, and why.
 *
 * `GET /guilds/{id}/bans?limit=1&after=<userId - 1>` rather than `GET /guilds/{id}/bans/{userId}`: the list
 * form always answers `200` with either an empty array or a single entry, so the happy path emits no 4xx at
 * all, and it carries the ban reason in the same call. The `after` arithmetic is what makes `limit=1` land on
 * the user in question -- bans come back ordered by user id ascending, so asking for the first entry strictly
 * above `userId - 1` returns that user's own ban when it exists.
 *
 * Returns `null` for "cannot tell", which is not the same as "not banned" and must never be collapsed into it:
 * a guild whose Appeals bot lacks `BAN_MEMBERS`, or that kicked it since, would otherwise report every
 * appellant as unbanned and turn a configuration problem into a wrong answer in front of a user.
 *
 * A definite answer is written through to `appeal_ban_checks`, which is a plain cache of probe results -- it
 * gives a returning appellant the servers they already checked without re-probing, and it is deliberately
 * allowed to go stale, since the probe re-establishes truth when they open a guild and again at submit.
 */
export async function probeGuildBan(
	guildId: Snowflake,
	userId: Snowflake,
	logger: Logger,
): Promise<AppealBanProbe | null> {
	const { redis } = getContext();

	if (await redis.exists(probeBlockedKey(guildId))) {
		return null;
	}

	let bans;
	try {
		bans = await discordAPIAppeals.guilds.getMemberBans(guildId, {
			after: String(BigInt(userId) - 1n),
			limit: 1,
		});
	} catch (error) {
		// `403` is the bot lacking `BAN_MEMBERS`; `404` is it not being in the guild any more. Both mean the
		// same thing to a caller -- there is no answer to be had here until somebody changes something in
		// Discord -- and both are worth not asking about again for a while.
		if (error instanceof DiscordAPIError && (error.status === 403 || error.status === 404)) {
			logger.warn({ err: error, guildId }, 'cannot probe bans for this guild, backing off');
			await redis.set(probeBlockedKey(guildId), '1', {
				expiration: { type: 'PX', value: PROBE_BLOCKED_TTL_MS },
			});

			return null;
		}

		throw error;
	}

	// Access can come back (permission granted, bot re-invited) well before a stale block would expire.
	await redis.del(probeBlockedKey(guildId));

	const entry = bans[0];
	const probe: AppealBanProbe =
		entry?.user.id === userId ? { banned: true, banReason: entry.reason ?? null } : { banned: false, banReason: null };

	await recordBanCheck(userId, guildId, probe);
	return probe;
}

/**
 * Every guild this appellant has already been probed against, newest check first. A hint for their landing
 * page, never an authority -- see this module's `probeGuildBan` and §4 on why there is no ban index here.
 */
export async function readBanChecks(userId: Snowflake): Promise<AppealBanChecks[]> {
	return getContext().db<AppealBanChecks[]>`
		SELECT * FROM appeal_ban_checks WHERE user_id = ${userId} ORDER BY checked_at DESC
	`;
}
