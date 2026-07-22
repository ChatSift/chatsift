import { getContext, type BotId } from '@chatsift/backend-core';
import type { Snowflake } from '@discordjs/core';
import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import type { MeGuild } from './me.js';

const oauthREST = new REST({ version: '10' });
export const discordAPIOAuth = new API(oauthREST);

const amaREST = new REST({ version: '10' }).setToken(getContext().env.AMA_BOT_TOKEN);
export const discordAPIAma = new API(amaREST);

// Webhook execution is authed by the id/token in the URL itself, no bot token needed
const webhookREST = new REST({ version: '10' });
export const discordAPIWebhook = new API(webhookREST);

export const APIMapping: Record<BotId, API> = {
	AMA: discordAPIAma,
};

// Tracks, per guild, the index (into that guild's `bots` array) that was last handed out by
// `roundRobinAPI`, so consecutive calls for the same guild cycle through all bots installed there.
const latest = new Map<Snowflake, number>();

/**
 * Picks the `API` client (i.e. bot token) to use for a Discord API call scoped to `guild`.
 *
 * A guild can have more than one ChatSift bot installed in it (`guild.bots`). Rather than always
 * using the same bot, for general maintanance calls, this spreads calls round-robin across
 * every bot present in the guild, so outbound request volume -- and therefore per-bot rate-limit bucket usage --
 * doesn't concentrate on a single token. Call it once per outbound Discord API request you're about to make, not once
 * up front and reused for a batch of calls, otherwise the batch never actually rotates across bots.
 *
 * The rotation state (`latest`) is in-memory and per-process: it resets on restart and isn't shared
 * across replicas, so this is a best-effort spread, not a strict guarantee.
 *
 * Requires `guild.bots` to be non-empty -- callers must check that themselves (e.g. a guild whose
 * bots were all kicked but which still has leftover data referencing it). Calling this with an
 * empty `guild.bots` does not throw; it silently returns `APIMapping[undefined]`, i.e. `undefined`.
 */
export function roundRobinAPI(guild: MeGuild): API {
	if (guild.bots.length === 1) {
		return APIMapping[guild.bots[0]!];
	}

	const index = latest.get(guild.id) ?? -1;
	const nextIndex = (index + 1) % guild.bots.length;
	latest.set(guild.id, nextIndex);

	return APIMapping[guild.bots[nextIndex]!];
}
