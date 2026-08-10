import { Buffer } from 'node:buffer';
import type { IncomingMessage, Server } from 'node:http';
import { setInterval, clearInterval } from 'node:timers';
import { URL } from 'node:url';
import { getContext, verifyWsTicket, REALTIME_INVALIDATE_CHANNEL } from '@chatsift/backend-core';
import type { RealtimeInvalidateMessage, WsTicketData } from '@chatsift/backend-core';
import type { RawData, WebSocket } from 'ws';
import { WebSocketServer } from 'ws';
import { isAuthorizedForChannel } from './authorizeChannel.js';
import { WsHub } from './hub.js';

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
 * `JSON.parse` alone only guarantees the raw string was valid JSON -- it says nothing about the resulting
 * value's shape (`"{}"`, `"null"`, `"[1,2,3]"` all parse cleanly). Every message on this Redis channel is
 * first-party today (`services/api` and `services/ama-bot` are the only publishers), but validating the shape
 * here anyway -- mirroring `parseClientMessage`'s same treatment of the client-facing WS messages above --
 * means a malformed payload gets logged and dropped instead of handing `hub.deliverLocal` a `channel` that
 * silently isn't a string.
 */
function parseInvalidateMessage(raw: string): RealtimeInvalidateMessage | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}

	if (typeof parsed !== 'object' || parsed === null) {
		return null;
	}

	const candidate = parsed as Partial<RealtimeInvalidateMessage>;
	if (candidate.type !== 'invalidate' || typeof candidate.channel !== 'string' || !candidate.channel) {
		return null;
	}

	if (candidate.originClientId !== undefined && typeof candidate.originClientId !== 'string') {
		return null;
	}

	return candidate as RealtimeInvalidateMessage;
}

/**
 * Attaches a `ws` WebSocket server to the same `http.Server` polka's HTTP handling already listens on (polka is
 * a thin router over a plain `http.Server` -- see the architecture notes for how this was confirmed),
 * handling the `/v3/ws` upgrade path only and leaving every other upgrade request untouched.
 *
 * Also opens a dedicated Redis subscriber connection (a client in `SUBSCRIBE` mode can't issue other commands,
 * so this can't reuse `getContext().redis`) listening on `REALTIME_INVALIDATE_CHANNEL` -- every mutation site,
 * whether it runs in this process (route handlers, via `mountRoute`'s `realtimeChannel` hook) or
 * `services/ama-bot` (Discord interaction handlers, which write straight to Postgres), publishes there via
 * `publishRealtimeInvalidate`. Nothing outside this module needs the `WsHub` instance -- delivery to local
 * sockets happens entirely inside the subscriber callback below -- so unlike the route handlers' side of this
 * (which goes through Redis, not a direct reference), this function has no return value.
 */
export async function attachWebSocketServer(httpServer: Server): Promise<void> {
	const hub = new WsHub();
	const wss = new WebSocketServer({ noServer: true });
	const logger = getContext().logger.child({ module: 'ws' });

	const subscriber = getContext().redis.duplicate();
	subscriber.on('error', (err) => logger.error(err, 'redis subscriber error'));
	await subscriber.connect();
	await subscriber.subscribe(REALTIME_INVALIDATE_CHANNEL, (raw) => {
		// `withTypeMapping`'s `BLOB_STRING -> Buffer` mapping (see `createRedis`) only applies to regular
		// command replies (GET, etc.) -- a pub/sub message's type is controlled by `subscribe`'s own
		// `bufferMode` param instead, which is left at its default (`false`) here, so `raw` is already `string`.
		const message = parseInvalidateMessage(raw);
		if (!message) {
			logger.warn({ raw }, 'discarding malformed realtime invalidate message');
			return;
		}

		hub.deliverLocal(message.channel, message);
	});

	const alive = new WeakMap<WebSocket, boolean>();

	// Called directly from `handleUpgrade`'s callback below (not via `wss.on('connection', ...)`) -- `ws`
	// doesn't type a 'connection' listener as accepting more than `(ws, request)`, and the ticket is only
	// available in this closure anyway, so routing it through as a synthetic third emit argument would just
	// be working around the types instead of with them.
	function setupConnection(ws: WebSocket, ticket: WsTicketData, clientId: string | null): void {
		if (clientId) {
			hub.registerClient(ws, clientId);
		}

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
					'rejected channel subscribe: ticket authorizes neither this channel nor its guild',
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

		// Optional: an older/unexpected client without one just never gets self-echo suppression, it isn't a
		// reason to reject the connection outright.
		const clientId = url.searchParams.get('clientId');

		wss.handleUpgrade(req, socket, head, (ws) => {
			setupConnection(ws, ticket, clientId);
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

	wss.on('close', () => {
		clearInterval(heartbeat);
		void (async () => {
			try {
				await subscriber.quit();
			} catch (error) {
				logger.error(error, 'failed to close redis subscriber');
			}
		})();
	});
}
