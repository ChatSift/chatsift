import { getContext } from './context.js';

/**
 * Redis pub/sub channel carrying WS-gateway invalidate signals. The single channel every mutation site
 * publishes to -- both `services/api` route handlers (via `mountRoute`'s `realtimeChannel` hook,
 * `services/api/src/core/server.ts`) and `services/ama-bot`'s Discord interaction handlers (button clicks,
 * modal submits), which write straight to Postgres and never touch the API process at all. `services/api`'s
 * `WsHub` (`services/api/src/ws/hub.ts` + `ws/server.ts`) is the only subscriber today, and re-delivers to
 * whichever locally-connected WS clients are subscribed to the named channel in the message.
 */
export const REALTIME_INVALIDATE_CHANNEL = 'ws:invalidate';

export interface RealtimeInvalidateMessage {
	channel: string;
	/**
	 * The `realtimeClientId` (`apps/website/src/api/realtimeClientId.ts`) of the browser tab whose own HTTP
	 * mutation caused this signal, if any -- `services/api/src/ws/hub.ts`'s `WsHub` uses this to skip
	 * delivering back to that exact tab's socket (it already knows, since its own mutation's `onSuccess`
	 * already invalidated its cache) while still delivering normally to every other connection, including
	 * other tabs of the same logged-in user. Deliberately not the acting user's id (a WS ticket's `sub`):
	 * `sub` is shared by every tab/device that user has open, so filtering on it would wrongly suppress the
	 * signal for a second tab that hasn't heard about the change yet. Absent for signals published from
	 * `services/ama-bot` (a Discord interaction has no "browser tab" to correlate against, and no HTTP request
	 * carrying the header this comes from) -- those always deliver to every connected client, unfiltered.
	 */
	originClientId?: string;
	type: 'invalidate';
}

/**
 * Publishes an invalidate signal for one or more WS gateway channels (`@chatsift/core`'s `realtimeChannels.ts`
 * builders). Never throws -- a failed publish just means a connected dashboard misses a live refresh, not that
 * the mutation that triggered it (already committed by the time every call site reaches this) should be treated
 * as failed, so this logs and swallows rather than propagating into the caller's own error handling.
 *
 * Several channels still go out as one message each -- the subscriber side (`services/api/src/ws/server.ts`)
 * dispatches on a single `channel`, and a multi-channel message shape would buy nothing there. What the batch
 * saves is the network: node-redis pipelines commands issued in the same tick, so `n` channels cost one round
 * trip instead of `n` sequential ones. That matters because callers publish *after* their mutation has already
 * committed, on the request's critical path.
 *
 * @param channels - The WS gateway channel(s) to invalidate. An empty array is a no-op.
 * @param originClientId - See `RealtimeInvalidateMessage.originClientId`. Applied to every channel in the
 * batch. Only ever set by `services/api/src/core/server.ts` (read off the mutation request's
 * `RealtimeClientIdHeader`) -- `services/ama-bot`'s call sites have no such header to read and always omit it.
 */
export async function publishRealtimeInvalidate(channels: string[] | string, originClientId?: string): Promise<void> {
	const list = typeof channels === 'string' ? [channels] : channels;
	if (!list.length) {
		return;
	}

	try {
		// One `Promise.all` rather than a loop of awaits so the publishes land in the same tick and get
		// pipelined. A partial failure rejects here and is swallowed like any other -- the channels that did
		// go out stay delivered, and the ones that didn't degrade to a stale tab, same as a total failure.
		await Promise.all(
			list.map(async (channel) => {
				const message: RealtimeInvalidateMessage = {
					type: 'invalidate',
					channel,
					...(originClientId && { originClientId }),
				};

				return getContext().redis.publish(REALTIME_INVALIDATE_CHANNEL, JSON.stringify(message));
			}),
		);
	} catch (error) {
		getContext().logger.warn({ err: error, channels: list }, 'failed to publish realtime invalidate signal');
	}
}
