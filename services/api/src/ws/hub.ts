import type { WebSocket } from 'ws';

export interface InvalidateMessage {
	channel: string;
	type: 'invalidate';
}

/**
 * In-process channel registry for the WebSocket gateway: `subscribe`/`unsubscribe`/`broadcast` over a plain
 * `Map<channel, Set<WebSocket>>`. `services/api` runs as a single process today (see `docker-compose.yml`), so
 * this is sufficient for correctness as-is -- if the API is ever horizontally scaled, a client connected to one
 * instance needs to learn about a broadcast triggered by a mutation handled on another, which is the point at
 * which this gets swapped for a Redis-pub/sub-backed implementation of the same three methods. Kept as a small
 * interface-shaped class specifically so that swap doesn't need to touch any call site (route handlers via
 * `Context.service.wsHub`, `services/api/src/ws/server.ts`).
 */
export class WsHub {
	private readonly channels = new Map<string, Set<WebSocket>>();

	/**
	 * Reverse index (which channels a given socket is subscribed to) so a disconnect only touches the
	 * channels that socket actually joined instead of scanning every channel in `channels`.
	 */
	private readonly subscriptions = new Map<WebSocket, Set<string>>();

	public broadcast(channel: string, message: InvalidateMessage): void {
		const sockets = this.channels.get(channel);
		if (!sockets) {
			return;
		}

		const payload = JSON.stringify(message);
		for (const ws of sockets) {
			// 1 === WebSocket.OPEN -- avoiding a runtime import of the `ws` value just for this constant
			if (ws.readyState === 1) {
				ws.send(payload);
			}
		}
	}

	public subscribe(ws: WebSocket, channel: string): void {
		let sockets = this.channels.get(channel);
		if (!sockets) {
			sockets = new Set();
			this.channels.set(channel, sockets);
		}

		sockets.add(ws);

		let subscribedChannels = this.subscriptions.get(ws);
		if (!subscribedChannels) {
			subscribedChannels = new Set();
			this.subscriptions.set(ws, subscribedChannels);
		}

		subscribedChannels.add(channel);
	}

	public unsubscribe(ws: WebSocket, channel: string): void {
		const sockets = this.channels.get(channel);
		sockets?.delete(ws);
		if (sockets?.size === 0) {
			this.channels.delete(channel);
		}

		this.subscriptions.get(ws)?.delete(channel);
	}

	/**
	 * Called once a socket closes/dies (clean close or the heartbeat sweep terminating a dead connection) --
	 * removes it from every channel it was subscribed to.
	 */
	public unsubscribeAll(ws: WebSocket): void {
		const subscribedChannels = this.subscriptions.get(ws);
		if (!subscribedChannels) {
			return;
		}

		for (const channel of subscribedChannels) {
			this.channels.get(channel)?.delete(ws);
			if (this.channels.get(channel)?.size === 0) {
				this.channels.delete(channel);
			}
		}

		this.subscriptions.delete(ws);
	}
}
