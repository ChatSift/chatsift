import type { InferRouteContract, getWsTicketRoute } from '@chatsift/api';
import { apiFetch } from './fetch';
import { REALTIME_CLIENT_ID } from './realtimeClientId';

type GetWsTicketContract = InferRouteContract<typeof getWsTicketRoute>;
type GetWsTicketResult = GetWsTicketContract['response'];

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
 * missed while disconnected, so a reconnect fires every still-subscribed channel's listeners once immediately,
 * on top of re-sending `subscribe` for each of them server-side.
 */
class RealtimeClient {
	private readonly channels = new Map<string, Set<InvalidateListener>>();

	private connecting = false;

	private reconnectAttempt = 0;

	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	private socket: WebSocket | null = null;

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
			}
		};
	}

	private connect(): void {
		this.connecting = true;

		void (async () => {
			try {
				const { ticket } = await apiFetch<GetWsTicketResult>('get', '/v3/ws/ticket');
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
					for (const channel of this.channels.keys()) {
						this.send({ type: 'subscribe', channel });
					}
				});

				socket.addEventListener('message', (event: MessageEvent<string>) => {
					this.handleMessage(event.data);
				});

				socket.addEventListener('close', () => {
					this.socket = null;
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

	private ensureConnected(): void {
		if (this.socket || this.connecting) {
			return;
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

			for (const listeners of this.channels.values()) {
				for (const listener of listeners) {
					listener();
				}
			}

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

export const realtimeClient = new RealtimeClient();
