import { Buffer } from 'node:buffer';
import type { IncomingMessage, Server } from 'node:http';
import { setInterval, clearInterval } from 'node:timers';
import { URL } from 'node:url';
import { getContext, verifyWsTicket } from '@chatsift/backend-core';
import type { WsTicketData } from '@chatsift/backend-core';
import type { RawData, WebSocket } from 'ws';
import { WebSocketServer } from 'ws';
import { WsHub } from './hub.js';

declare module '@chatsift/backend-core' {
	interface ContextService {
		/**
		 * The gateway's channel registry, so any route handler can broadcast an invalidation signal via
		 * `getContext().service.wsHub` after a successful mutation (see `realtimeChannel` on `defineRoute`,
		 * `services/api/src/core/server.ts`) without importing this module directly.
		 */
		wsHub: WsHub;
	}
}

const WS_PATH = '/v3/ws';
const HEARTBEAT_INTERVAL_MS = 30_000;

interface SubscribeMessage {
	channel: string;
	type: 'subscribe' | 'unsubscribe';
}

/**
 * `ws`'s `RawData` union (`Buffer | ArrayBuffer | Buffer[]`) has no single safe `.toString()` -- an
 * `ArrayBuffer` doesn't override `Object.prototype.toString`, and a fragmented message arrives as
 * `Buffer[]` rather than one contiguous `Buffer`. Normalizing all three via `Buffer.from`/`Buffer.concat`
 * first, rather than assuming every message arrives as a single `Buffer`, keeps this correct instead of
 * silently mis-parsing a fragmented frame.
 */
function rawDataToString(raw: RawData): string {
	if (Array.isArray(raw)) {
		return Buffer.concat(raw).toString('utf8');
	}

	if (Buffer.isBuffer(raw)) {
		return raw.toString('utf8');
	}

	return Buffer.from(raw).toString('utf8');
}

function parseClientMessage(raw: RawData): SubscribeMessage | null {
	try {
		const parsed = JSON.parse(rawDataToString(raw)) as Partial<SubscribeMessage>;
		if (
			(parsed.type !== 'subscribe' && parsed.type !== 'unsubscribe') ||
			typeof parsed.channel !== 'string' ||
			!parsed.channel
		) {
			return null;
		}

		return parsed as SubscribeMessage;
	} catch {
		return null;
	}
}

/**
 * A channel is `<domain>:<guildId>:<...>` (see `@chatsift/core`'s `realtimeChannels.ts`) -- authorization only
 * ever needs the guild id, not the rest of the channel's shape, so this stays generic across every current and
 * future channel domain instead of each one needing its own authorization function.
 */
function isAuthorizedForChannel(ticket: WsTicketData, channel: string): boolean {
	const guildId = channel.split(':')[1];
	if (!guildId) {
		return false;
	}

	return ticket.isAdmin || ticket.adminGuilds.includes(guildId);
}

/**
 * Attaches a `ws` WebSocket server to the same `http.Server` polka's HTTP handling already listens on (polka is
 * a thin router over a plain `http.Server` -- see the architecture notes for how this was confirmed),
 * handling the `/v3/ws` upgrade path only and leaving every other upgrade request untouched.
 *
 * Returns the `WsHub` so `app.ts` can register it on `Context.service` for route handlers to broadcast through.
 */
export function attachWebSocketServer(httpServer: Server): WsHub {
	const hub = new WsHub();
	const wss = new WebSocketServer({ noServer: true });
	const logger = getContext().logger.child({ module: 'ws' });

	const alive = new WeakMap<WebSocket, boolean>();

	// Called directly from `handleUpgrade`'s callback below (not via `wss.on('connection', ...)`) -- `ws`
	// doesn't type a 'connection' listener as accepting more than `(ws, request)`, and the ticket is only
	// available in this closure anyway, so routing it through as a synthetic third emit argument would just
	// be working around the types instead of with them.
	function setupConnection(ws: WebSocket, ticket: WsTicketData): void {
		alive.set(ws, true);

		ws.on('pong', () => alive.set(ws, true));

		ws.on('message', (raw: RawData) => {
			const message = parseClientMessage(raw);
			if (!message) {
				return;
			}

			if (!isAuthorizedForChannel(ticket, message.channel)) {
				logger.warn(
					{ sub: ticket.sub, channel: message.channel },
					'rejected channel subscribe: not a manager of this guild',
				);
				return;
			}

			if (message.type === 'subscribe') {
				hub.subscribe(ws, message.channel);
			} else {
				hub.unsubscribe(ws, message.channel);
			}
		});

		ws.on('close', () => {
			hub.unsubscribeAll(ws);
			alive.delete(ws);
		});
	}

	httpServer.on('upgrade', (req: IncomingMessage, socket, head) => {
		const url = new URL(req.url ?? '', 'http://internal');
		if (url.pathname !== WS_PATH) {
			// No other upgrade path is served yet -- reject outright rather than leaving the socket to hang
			// with no response, which is what a bare `return` here would do.
			socket.destroy();
			return;
		}

		const origin = req.headers.origin;
		if (origin && !getContext().env.CORS.test(origin)) {
			logger.warn({ origin }, 'rejected ws upgrade: origin not allowed');
			socket.destroy();
			return;
		}

		const ticket = verifyWsTicket(url.searchParams.get('ticket') ?? undefined);
		if (!ticket) {
			logger.warn('rejected ws upgrade: invalid or expired ticket');
			socket.destroy();
			return;
		}

		wss.handleUpgrade(req, socket, head, (ws) => {
			setupConnection(ws, ticket);
		});
	});

	// Prunes connections that die without a clean `close` event (laptop sleep, network drop) -- `ws`'s
	// documented idiom: ping every socket, terminate any that didn't pong since the last sweep.
	const heartbeat = setInterval(() => {
		for (const ws of wss.clients) {
			if (alive.get(ws) === false) {
				hub.unsubscribeAll(ws);
				ws.terminate();
				continue;
			}

			alive.set(ws, false);
			ws.ping();
		}
	}, HEARTBEAT_INTERVAL_MS);
	heartbeat.unref();

	wss.on('close', () => clearInterval(heartbeat));

	return hub;
}
