import { randomUUID } from 'node:crypto';
import { getContext } from '../context.js';

/**
 * Short-lived capability letting one member view their *own* AutoModerator case history on the dashboard
 * without a session (`/myhistory`).
 */
const TOKEN_TTL_MS = 5 * 60 * 1_000;

/**
 * Surfaced so the bot can tell the user how long their link lasts without restating the number.
 */
export const HISTORY_TOKEN_TTL_MINUTES = TOKEN_TTL_MS / 60_000;

const tokenKey = (token: string): string => `automoderator:historytoken:${token}`;

export interface HistoryTokenTarget {
	guildId: string;
	userId: string;
}

export async function mintHistoryToken(target: HistoryTokenTarget): Promise<string> {
	const token = randomUUID();

	await getContext().redis.set(tokenKey(token), JSON.stringify(target), {
		expiration: { type: 'PX', value: TOKEN_TTL_MS },
	});

	return token;
}

export async function resolveHistoryToken(token: string): Promise<HistoryTokenTarget | null> {
	const raw = await getContext().redis.get(tokenKey(token));
	if (!raw) {
		return null;
	}

	return JSON.parse(raw.toString()) as HistoryTokenTarget;
}
