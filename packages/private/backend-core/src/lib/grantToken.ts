import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getContext } from './context.js';

/**
 * Scoped capability strings for the one-time "grant token" auth path (alternative to a full
 * OAuth session): a bot slash command mints one of these, scoped to a single guild + user, and
 * the API accepts it in place of a session on routes that opt in via `isAuthed`'s `grants` option.
 */
export const GRANTS = {
	AMA_CREATE: 'ama:create',
} as const;
export type GrantString = (typeof GRANTS)[keyof typeof GRANTS];

export interface GrantTokenData {
	/**
	 * The single capability this token grants.
	 */
	grant: GrantString;
	/**
	 * Guild the command was run in — the token only authorizes action within this guild.
	 */
	guildId: string;
	iat: number;
	/**
	 * Unique id, used to enforce one-time use via redis.
	 */
	jti: string;
	/**
	 * Hard discriminator so a grant token can never be mistaken for an access/refresh token.
	 */
	kind: 'grant';
	/**
	 * Discord user id who ran the command that minted this token.
	 */
	sub: string;
}

const GRANT_TOKEN_TTL_SECONDS = 15 * 60;

export function createGrantToken(data: Pick<GrantTokenData, 'grant' | 'guildId' | 'sub'>): string {
	const payload: Omit<GrantTokenData, 'iat'> = {
		kind: 'grant',
		sub: data.sub,
		guildId: data.guildId,
		grant: data.grant,
		jti: randomUUID(),
	};

	return jwt.sign(payload, getContext().env.ENCRYPTION_KEY, { expiresIn: GRANT_TOKEN_TTL_SECONDS });
}

/**
 * Returns the payload only if the JWT is valid AND is a grant token; `null` otherwise (expired,
 * malformed, tampered, or a differently-shaped token like an access/refresh token) so callers can
 * fall back to normal session auth.
 */
export function verifyGrantToken(token: string | undefined): GrantTokenData | null {
	if (!token) {
		return null;
	}

	try {
		const decoded = jwt.verify(token, getContext().env.ENCRYPTION_KEY) as Partial<GrantTokenData>;
		if (decoded.kind !== 'grant' || !decoded.jti || !decoded.guildId || !decoded.grant) {
			return null;
		}

		return decoded as GrantTokenData;
	} catch {
		return null;
	}
}

const usedKey = (jti: string): string => `grant:used:${jti}`;

export async function isGrantConsumed(jti: string): Promise<boolean> {
	return (await getContext().redis.exists(usedKey(jti))) === 1;
}

/**
 * Marks a grant token spent. TTL matches the max token lifetime so the key self-cleans.
 */
export async function consumeGrantToken(jti: string): Promise<void> {
	await getContext().redis.set(usedKey(jti), '1', { expiration: { type: 'EX', value: GRANT_TOKEN_TTL_SECONDS } });
}
