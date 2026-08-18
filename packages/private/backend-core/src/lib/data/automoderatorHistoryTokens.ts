import { randomUUID } from 'node:crypto';
import type { Recipe } from 'bin-rw';
import { createRecipe, DataType } from 'bin-rw';
import { RedisStore } from './_store.js';

/**
 * Short-lived capability letting one member view their *own* AutoModerator case history on the dashboard
 * without a session (`/myhistory`).
 */
const TOKEN_TTL_MS = 5 * 60 * 1_000;

/**
 * Surfaced so the bot can tell the user how long their link lasts without restating the number.
 */
export const HISTORY_TOKEN_TTL_MINUTES = TOKEN_TTL_MS / 60_000;

export interface HistoryTokenTarget {
	guildId: string;
	userId: string;
}

/**
 * bin-rw rather than `JSON.stringify`, matching `MeStore` and every other structured value this codebase keeps
 * in redis. `versioned: true` is the part that earns it: if this payload ever grows a field, a token minted by
 * the old code decodes to a shape that no longer matches and `RedisStore` evicts it instead of handing a
 * half-populated `HistoryTokenTarget` to a query that would then read the wrong guild's cases.
 *
 * bin-rw's inferred type widens every `DataType.String` to `string | null`, whereas neither field here is
 * nullable -- the cast corrects that, the same way `meRecipe` does.
 */
const tokenRecipe = createRecipe(
	{
		guildId: DataType.String,
		userId: DataType.String,
	},
	{ versioned: true },
) as Recipe<HistoryTokenTarget>;

const HistoryTokenStore = new RedisStore<HistoryTokenTarget>({
	TTL: TOKEN_TTL_MS,
	recipe: tokenRecipe,
	makeKey: (token: string) => `automoderator:historytoken:${token}`,
	// The five minutes are an absolute budget, not an idle timeout: this is a capability handed out in a Discord
	// reply, and reloading the page it points at must not keep extending how long that link stays live.
	refreshTTLOnRead: false,
	storeOld: false,
});

export async function mintHistoryToken(target: HistoryTokenTarget): Promise<string> {
	const token = randomUUID();
	await HistoryTokenStore.set(token, target);

	return token;
}

export async function resolveHistoryToken(token: string): Promise<HistoryTokenTarget | null> {
	return HistoryTokenStore.get(token);
}
