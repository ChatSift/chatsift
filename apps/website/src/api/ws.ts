import type { InferRouteContract, getWsTicketRoute, publicAMAWsTicketRoute } from '@chatsift/api';
import { apiFetch } from './fetch';
import { REALTIME_CLIENT_ID } from './realtimeClientId';

type GetWsTicketContract = InferRouteContract<typeof getWsTicketRoute>;
type GetWsTicketResult = GetWsTicketContract['response'];

type PublicWsTicketContract = InferRouteContract<typeof publicAMAWsTicketRoute>;
type PublicWsTicketResult = PublicWsTicketContract['response'];

/**
 * How a client obtains a fresh gateway ticket. Injected rather than hardcoded because the public answers page
 * has no session to mint one from and goes through its own share-token endpoint instead (#323) -- everything
 * else about the connection (backoff, re-subscribe, self-echo suppression) is identical between the two.
 */
type TicketMinter = () => Promise<string>;

interface ServerMessage {
	channel: string;
	type: 'invalidate';
}

type InvalidateListener = () => void;

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;

function wsURL(): string {
	const url = new URL('/v3/ws', process.env['NEXT_PUBLIC_API_URL']);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	return url.toString();
}

/**
 * Lazily-connected singleton gateway client -- opens on the first `subscribe()` call rather than eagerly, so
 * pages that never touch realtime data (most of the dashboard, today) never pay for a socket. Mints a fresh
 * ticket (`GET /v3/ws/ticket`, normal cookie-backed session auth) on every connect attempt since tickets are
 * short-lived (`wsTicket.ts`) and deliberately not single-use -- see `docs/roadmap` plan for the gateway.
 *
 * This is a cache-invalidation bus, not a durable event log: there's no replay/ordering guarantee for signals
 * missed while a socket wasn't subscribed. Every connect therefore fires each subscribed channel's listeners
 * once from the `open` handler, right after re-sending `subscribe` for them -- covering both the initial
 * startup gap (mint + handshake, after the page's own first fetch) and any reconnect.
 */
export class RealtimeClient {
	private readonly channels = new Map<string, Set<InvalidateListener>>();

	private connecting = false;

	private reconnectAttempt = 0;

	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	private socket: WebSocket | null = null;

	public constructor(private readonly mintTicket: TicketMinter) {}

	public subscribe(channel: string, onInvalidate: InvalidateListener): () => void {
		let listeners = this.channels.get(channel);
		if (!listeners) {
			listeners = new Set();
			this.channels.set(channel, listeners);
		}

		listeners.add(onInvalidate);
		this.send({ type: 'subscribe', channel });
		this.ensureConnected();

		return () => {
			listeners.delete(onInvalidate);
			if (listeners.size === 0) {
				this.channels.delete(channel);
				this.send({ type: 'unsubscribe', channel });

				// Nothing left subscribed anywhere -- tear the socket down instead of leaving it open with
				// zero subscriptions, matching this class's whole "lazily-connected" premise. The next
				// `subscribe()` call reconnects from scratch.
				if (this.channels.size === 0) {
					this.disconnect();
				}
			}
		};
	}

	private connect(): void {
		this.connecting = true;

		void (async () => {
			try {
				const ticket = await this.mintTicket();

				// Every consumer unsubscribed while the ticket was in flight (a fast navigate away from a
				// realtime page). `disconnect()` can't have stopped us: it only closes `this.socket`, which is
				// still null this whole time. Bailing before the socket exists is the only way to avoid leaving
				// one open with nothing subscribed to it -- `scheduleReconnect` bails on an empty `channels`, so
				// nothing downstream would ever reap it.
				if (this.channels.size === 0) {
					return;
				}

				// `clientId` (same value `fetch.ts` sends as `RealtimeClientIdHeader` on every mutation, see
				// `realtimeClientId.ts`) tags this specific socket so the server can skip echoing an invalidate
				// signal back to the tab whose own mutation caused it.
				const url = new URL(wsURL());
				url.searchParams.set('ticket', ticket);
				if (REALTIME_CLIENT_ID) {
					url.searchParams.set('clientId', REALTIME_CLIENT_ID);
				}

				const socket = new WebSocket(url);

				socket.addEventListener('open', () => {
					this.reconnectAttempt = 0;

					// Same race as above, one await later: the handshake is its own window for the last
					// consumer to go away.
					if (this.channels.size === 0) {
						socket.close();
						return;
					}

					for (const channel of this.channels.keys()) {
						this.send({ type: 'subscribe', channel });
					}

					// Nothing that happened before this socket was subscribed produced a signal we could have
					// received, so every channel gets one catch-up invalidation now that it can. That covers the
					// startup gap (the page's own first fetch resolves, then the ticket round trip and handshake
					// run -- a mutation landing in between would otherwise be missed until the *next* one) as
					// well as the reconnect gap, since this is a plain invalidation bus with no replay.
					//
					// Costs one redundant refetch per connect, immediately after the initial fetch. Cheap next
					// to silently serving stale data indefinitely, and TanStack dedupes it whenever the first
					// fetch is still in flight.
					for (const listeners of this.channels.values()) {
						for (const listener of listeners) {
							listener();
						}
					}
				});

				socket.addEventListener('message', (event: MessageEvent<string>) => {
					this.handleMessage(event.data);
				});

				socket.addEventListener('close', () => {
					// Only clear `this.socket` if it's still literally this socket -- `disconnect()` (called
					// from the unsubscribe path above) already nulls it out synchronously and may have let a
					// fresh `subscribe()` open a newer socket before this (asynchronous) close event fires;
					// blindly nulling here would wipe out that newer, still-live connection.
					if (this.socket === socket) {
						this.socket = null;
					}

					this.scheduleReconnect();
				});

				// A transport-level error is always followed by a `close` event -- reconnect scheduling lives
				// there only, so this just tears the socket down instead of duplicating that logic.
				socket.addEventListener('error', () => {
					socket.close();
				});

				this.socket = socket;
			} catch {
				this.scheduleReconnect();
			} finally {
				this.connecting = false;
			}
		})();
	}

	private disconnect(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		this.socket?.close();
		this.socket = null;
	}

	private ensureConnected(): void {
		if (this.socket || this.connecting) {
			return;
		}

		// A `subscribe()` can land while a previous disconnect is still backing off (socket is null,
		// `connecting` is false, but a reconnect is scheduled) -- clearing the stale timer here avoids it
		// firing later and opening a second, redundant connection on top of the one started immediately below.
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		this.connect();
	}

	private handleMessage(data: string): void {
		let message: ServerMessage;
		try {
			message = JSON.parse(data) as ServerMessage;
		} catch {
			return;
		}

		if (message.type !== 'invalidate') {
			return;
		}

		for (const listener of this.channels.get(message.channel) ?? []) {
			listener();
		}
	}

	private scheduleReconnect(): void {
		// Nothing subscribed any more (every consumer unmounted while we were connected/reconnecting) --
		// the next `subscribe()` call starts a fresh connect instead.
		if (this.channels.size === 0 || this.reconnectTimer) {
			return;
		}

		const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_DELAY_MS);
		this.reconnectAttempt += 1;

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;

			// Any of these mean this reconnect is no longer needed: every consumer unsubscribed while it was
			// pending (`disconnect()` would have cleared this timer too, but a fresh `subscribe()` racing
			// against that isn't impossible to reason about defensively), or a fresh `subscribe()` already
			// opened -- or is opening -- a new connection in the meantime via `ensureConnected()`.
			if (this.channels.size === 0 || this.socket || this.connecting) {
				return;
			}

			// The catch-up invalidation deliberately isn't fired here -- the `open` handler does it instead, so
			// it lands once subscriptions are actually re-established rather than optimistically ahead of a
			// reconnect that may itself fail.
			this.connect();
		}, delay);
	}

	private send(message: { channel: string; type: 'subscribe' | 'unsubscribe' }): void {
		// Not open yet (still connecting, or between reconnect attempts) -- dropped silently. The `open`
		// handler above re-sends `subscribe` for every registered channel once the socket comes up, so this
		// never needs its own buffer/queue.
		if (this.socket?.readyState === WebSocket.OPEN) {
			this.socket.send(JSON.stringify(message));
		}
	}
}

/**
 * The session-backed client every authenticated page uses -- one socket per tab, shared across channels.
 */
export const realtimeClient = new RealtimeClient(
	async () => (await apiFetch<GetWsTicketResult>('get', '/v3/ws/ticket')).ticket,
);

/**
 * A client for the public answers page (#323), scoped to one share token. Deliberately *not* the singleton
 * above: that one mints its ticket from the session, and this page is reachable (and normally read) with no
 * session at all -- knowing the share token is the whole authorization, exactly as it is for the page's own
 * data fetch.
 *
 * Constructing one is inert (the socket only opens on the first `subscribe`), but the instance still has to be
 * stable across renders, since `useRealtimeInvalidate` re-subscribes when it changes -- callers should go
 * through `usePublicRealtimeClient` rather than calling this in a render body.
 */
export function createPublicRealtimeClient(shareToken: string): RealtimeClient {
	return new RealtimeClient(
		async () =>
			(await apiFetch<PublicWsTicketResult>('get', `/v3/ama/public/${encodeURIComponent(shareToken)}/ws-ticket`))
				.ticket,
	);
}
