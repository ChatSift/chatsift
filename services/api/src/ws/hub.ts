import type { RealtimeInvalidateMessage } from '@chatsift/backend-core';
import type { WebSocket } from 'ws';

/**
 * In-process channel registry for the WebSocket gateway: `subscribe`/`unsubscribe`/`deliverLocal` over a plain
 * `Map<channel, Set<WebSocket>>`, scoped to sockets connected to this API process. Fed exclusively by the
 * Redis pub/sub subscription set up in `services/api/src/ws/server.ts` -- mutation handlers (in this process
 * or `services/ama-bot`) never call `deliverLocal` directly, they publish through `@chatsift/backend-core`'s
 * `publishRealtimeInvalidate`, so a broadcast reaches every API instance's `WsHub` (today: just this one; if
 * the API is ever horizontally scaled, this already works unchanged since Redis pub/sub fans out to every
 * subscribed instance) regardless of which process the mutation actually happened in.
 */
export class WsHub {
	private readonly channels = new Map<string, Set<WebSocket>>();

	/**
	 * Each socket's `realtimeClientId` (`apps/website/src/api/realtimeClientId.ts`, sent as `?clientId=` on the
	 * WS handshake -- see `ws/server.ts`), so `deliverLocal` can skip echoing a signal back to the one socket
	 * whose own mutation caused it (`RealtimeInvalidateMessage.originClientId`'s doc comment has the full
	 * reasoning for why this can't just be keyed on the authenticated user instead). A `WeakMap` here needs no
	 * explicit cleanup on disconnect, same as the heartbeat's `alive` map in `ws/server.ts`.
	 */
	private readonly clientIds = new WeakMap<WebSocket, string>();

	/**
	 * Reverse index (which channels a given socket is subscribed to) so a disconnect only touches the
	 * channels that socket actually joined instead of scanning every channel in `channels`.
	 */
	private readonly subscriptions = new Map<WebSocket, Set<string>>();

	public deliverLocal(channel: string, message: RealtimeInvalidateMessage): void {
		const sockets = this.channels.get(channel);
		if (!sockets) {
			return;
		}

		const payload = JSON.stringify(message);
		for (const ws of sockets) {
			// Skip the one socket that caused this signal in the first place -- it already knows (its own
			// mutation's `onSuccess` already invalidated its cache), and re-delivering here would only cause
			// a redundant refetch. Every other socket, including other tabs of the same user, still gets it.
			if (message.originClientId && this.clientIds.get(ws) === message.originClientId) {
				continue;
			}

			// 1 === WebSocket.OPEN -- avoiding a runtime import of the `ws` value just for this constant
			if (ws.readyState === 1) {
				ws.send(payload);
			}
		}
	}

	/**
	 * Records which `realtimeClientId` a socket connected with, if any -- called once from `ws/server.ts`'s
	 * `setupConnection`, before any `subscribe` call for that socket.
	 */
	public registerClient(ws: WebSocket, clientId: string): void {
		this.clientIds.set(ws, clientId);
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
