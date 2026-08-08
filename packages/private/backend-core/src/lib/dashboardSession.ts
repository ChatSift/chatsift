import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getContext } from './context.js';

/**
 * Single-use, ~2-minute credential a `/dashboard` slash command mints and embeds in the link it replies with.
 * The API's `/v3/auth/dashboard` exchange route is the only consumer: it verifies + claims this token, then
 * mints a normal guild-scoped session (see `DASHBOARD_SESSION_TTL_SECONDS` below) and 302s the browser to a
 * clean dashboard URL. This token itself is never usable as a session credential.
 */
export interface DashboardLinkTokenData {
	/**
	 * Guild the command was run in -- the session this token exchanges for only ever authorizes this one guild.
	 */
	guildId: string;
	iat: number;
	/**
	 * Unique id, used to enforce one-time use via redis.
	 */
	jti: string;
	/**
	 * Hard discriminator so a link token can never be mistaken for an access/refresh token.
	 */
	kind: 'dashboard-link';
	/**
	 * Discord user id who ran the command that minted this token.
	 */
	sub: string;
}

const DASHBOARD_LINK_TOKEN_TTL_SECONDS = 2 * 60;

export function createDashboardLinkToken(data: Pick<DashboardLinkTokenData, 'guildId' | 'sub'>): string {
	const payload: Omit<DashboardLinkTokenData, 'iat'> = {
		kind: 'dashboard-link',
		sub: data.sub,
		guildId: data.guildId,
		jti: randomUUID(),
	};

	return jwt.sign(payload, getContext().env.ENCRYPTION_KEY, { expiresIn: DASHBOARD_LINK_TOKEN_TTL_SECONDS });
}

/**
 * Returns the payload only if the JWT is valid AND is a link token; `null` otherwise (expired, malformed,
 * tampered, or a differently-shaped token like an access/refresh token).
 */
export function verifyDashboardLinkToken(token: string | undefined): DashboardLinkTokenData | null {
	if (!token) {
		return null;
	}

	try {
		const decoded = jwt.verify(token, getContext().env.ENCRYPTION_KEY) as Partial<DashboardLinkTokenData>;
		if (decoded.kind !== 'dashboard-link' || !decoded.jti || !decoded.guildId || !decoded.sub) {
			return null;
		}

		return decoded as DashboardLinkTokenData;
	} catch {
		return null;
	}
}

const linkUsedKey = (jti: string): string => `dashboard:link:used:${jti}`;

/**
 * Atomically claims a link token for use via `SET ... NX` -- a separate check-then-later-consume would leave a
 * window where two concurrent exchange requests for the same `jti` can both observe "not used" and both
 * proceed. TTL matches the token's own lifetime so the key self-cleans.
 */
export async function claimDashboardLinkToken(jti: string): Promise<boolean> {
	const result = await getContext().redis.set(linkUsedKey(jti), '1', {
		condition: 'NX',
		expiration: { type: 'EX', value: DASHBOARD_LINK_TOKEN_TTL_SECONDS },
	});

	return result !== null;
}

/**
 * Absolute lifetime of a `/dashboard`-minted session -- not extended by access-token rotation (see
 * `services/api/src/util/tokens.ts`'s `createScopedRefreshToken`, which clamps its `expiresIn` to whatever
 * remains of this window). Deliberately short: the credential asserts full guild-manager access to one guild,
 * so its blast radius is bounded primarily by time, not by capability the way the old per-action grant tokens
 * were.
 */
export const DASHBOARD_SESSION_TTL_SECONDS = 30 * 60;

const sessionKey = (sid: string): string => `dashboard:session:${sid}`;
const sessionIndexKey = (sub: string, guildId: string): string => `dashboard:session:index:${sub}:${guildId}`;

export interface DashboardSessionRecord {
	guildId: string;
	sub: string;
}

/**
 * Registers a new scoped session's `sid` as live in redis (`DASHBOARD_SESSION_TTL_SECONDS` TTL), and indexes it
 * under `(sub, guildId)` so `revokeDashboardSessionsFor` (the `/dashboard revoke` command) can find and kill
 * every live session for that pair without a `KEYS` scan.
 */
export async function startDashboardSession(sid: string, data: DashboardSessionRecord): Promise<void> {
	const redis = getContext().redis;
	const indexKey = sessionIndexKey(data.sub, data.guildId);

	await redis.set(sessionKey(sid), '1', { expiration: { type: 'EX', value: DASHBOARD_SESSION_TTL_SECONDS } });
	await redis.sAdd(indexKey, sid);
	await redis.expire(indexKey, DASHBOARD_SESSION_TTL_SECONDS);
}

export async function isDashboardSessionLive(sid: string): Promise<boolean> {
	return Boolean(await getContext().redis.exists(sessionKey(sid)));
}

export async function revokeDashboardSession(sid: string): Promise<void> {
	await getContext().redis.del(sessionKey(sid));
}

/**
 * Kills every live scoped session for `(sub, guildId)` -- backs the `/dashboard revoke` subcommand, which runs
 * from Discord and so has no `sid` of its own to target (that only ever lives in the browser's session cookie).
 */
export async function revokeDashboardSessionsFor(sub: string, guildId: string): Promise<void> {
	const redis = getContext().redis;
	const indexKey = sessionIndexKey(sub, guildId);

	const sids = await redis.sMembers(indexKey);
	if (sids.length > 0) {
		await redis.del(sids.map((sid) => sessionKey(sid.toString())));
	}

	await redis.del(indexKey);
}
