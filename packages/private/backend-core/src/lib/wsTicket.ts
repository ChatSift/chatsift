import jwt from 'jsonwebtoken';
import { getContext } from './context.js';

/**
 * Short-lived credential for the WebSocket gateway's upgrade handshake (`services/api/src/ws/server.ts`).
 * Browsers can't set custom headers on a `WebSocket` handshake, so the normal session/grant-token auth
 * (both `Authorization`-header-only, see `services/api/src/middleware/isAuthed.ts`) doesn't apply here --
 * a ticket is minted from an authenticated HTTP request (`GET /v3/ws/ticket`, cookie-backed session auth
 * works normally there) and passed as a `?ticket=` query param when opening the socket instead.
 *
 * Carries exactly what `isAuthed`'s `isGuildManager` check already uses (`grants.adminGuilds` +
 * the global-admin bypass), plus an explicit per-channel allowlist for the access paths that aren't
 * guild-manager grants at all (`channels`), so per-channel authorization at subscribe-time is a plain
 * in-memory check against the ticket's own claims -- no Discord/DB call needed on every subscribe.
 */
export interface WsTicketData {
	adminGuilds: string[];
	/**
	 * Channels this ticket may subscribe to by exact string match, *in addition to* the guild-wide
	 * `adminGuilds` grant. Needed because not every kind of access is a guild-manager grant:
	 *
	 * - An AMA guest's access lives in `ama_sessions.guest_ids` and is deliberately independent of
	 *   `meCanManage` (a guest-only guild is synthesized with `meCanManage: false`, see `util/me.ts`), so
	 *   it never reaches `adminGuilds` -- their specific `amaQuestionsChannel`s are listed here instead,
	 *   mirroring `isAuthed`'s `'or-ama-guest'` path on the HTTP side.
	 * - The public answers page (`/v3/ama/public/:shareToken`) is unauthenticated entirely; its ticket
	 *   carries nothing *but* the one `amaPublicAnswersChannel` the share token resolves to.
	 *
	 * Resolved once at mint time rather than checked per subscribe, so it's as stale as `adminGuilds`
	 * already is -- bounded by the 60s TTL plus the client re-minting on every (re)connect.
	 */
	channels: string[];
	iat: number;
	isAdmin: boolean;
	/**
	 * Hard discriminator so a ticket can never be mistaken for an access/refresh/grant token.
	 */
	kind: 'ws';
	sub: string;
}

const WS_TICKET_TTL_SECONDS = 60;

export function createWsTicket(data: Pick<WsTicketData, 'adminGuilds' | 'channels' | 'isAdmin' | 'sub'>): string {
	const payload: Omit<WsTicketData, 'iat'> = {
		kind: 'ws',
		sub: data.sub,
		adminGuilds: data.adminGuilds,
		channels: data.channels,
		isAdmin: data.isAdmin,
	};

	return jwt.sign(payload, getContext().env.ENCRYPTION_KEY, { expiresIn: WS_TICKET_TTL_SECONDS });
}

/**
 * Returns the payload only if the JWT is valid AND is a ws ticket; `null` otherwise (expired, malformed,
 * tampered, or a differently-shaped token like an access/refresh/grant token).
 *
 * Deliberately not single-use (unlike `verifyDashboardLinkToken`'s token, see `dashboardSession.ts`) -- a
 * ticket only authorizes opening a socket, not a state-changing action, and exposure is already bounded by the
 * short TTL. A reconnecting client must be free to fetch-and-use a fresh ticket on every attempt without racing
 * a single-use claim against itself.
 */
export function verifyWsTicket(token: string | undefined): WsTicketData | null {
	if (!token) {
		return null;
	}

	try {
		const decoded = jwt.verify(token, getContext().env.ENCRYPTION_KEY) as Partial<WsTicketData>;
		if (decoded.kind !== 'ws' || !decoded.sub || !Array.isArray(decoded.adminGuilds)) {
			return null;
		}

		return {
			...decoded,
			channels: Array.isArray(decoded.channels) ? decoded.channels : [],
		} as WsTicketData;
	} catch {
		return null;
	}
}
