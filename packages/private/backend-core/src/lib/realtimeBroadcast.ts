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
 * Publishes an invalidate signal for a WS gateway channel (`@chatsift/core`'s `realtimeChannels.ts` builders).
 * Never throws -- a failed publish just means a connected dashboard misses a live refresh, not that the
 * mutation that triggered it (already committed by the time every call site reaches this) should be treated
 * as failed, so this logs and swallows rather than propagating into the caller's own error handling.
 *
 * @param channel - The WS gateway channel to invalidate (`@chatsift/core`'s `realtimeChannels.ts` builders).
 * @param originClientId - See `RealtimeInvalidateMessage.originClientId`. Only ever set by
 * `services/api/src/core/server.ts` (read off the mutation request's `RealtimeClientIdHeader`) --
 * `services/ama-bot`'s call sites have no such header to read and always omit it.
 */
export async function publishRealtimeInvalidate(channel: string, originClientId?: string): Promise<void> {
	const message: RealtimeInvalidateMessage = { type: 'invalidate', channel, ...(originClientId && { originClientId }) };

	try {
		await getContext().redis.publish(REALTIME_INVALIDATE_CHANNEL, JSON.stringify(message));
	} catch (error) {
		getContext().logger.warn({ err: error, channel }, 'failed to publish realtime invalidate signal');
	}
}
