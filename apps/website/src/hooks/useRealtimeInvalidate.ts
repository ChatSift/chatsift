'use client';

import { useEffect, useRef } from 'react';
import type { RealtimeClient } from '@/api/ws';
import { realtimeClient } from '@/api/ws';

/**
 * Subscribes to a WS gateway channel (`@chatsift/core`'s `realtimeChannels.ts` builders) for the lifetime of
 * the component, re-running `onInvalidate` (a TanStack Query cache invalidation, typically) whenever the
 * server signals something on that channel changed. `onInvalidate` is read through a ref so callers don't need
 * to memoize it themselves.
 *
 * `client` defaults to the session-backed singleton, which is what every page under `/dashboard` wants. The
 * public answers page passes its own share-token-backed client instead (`usePublicRealtimeClient`, #323) --
 * it must be a stable reference across renders, since changing it re-runs the effect.
 */
export function useRealtimeInvalidate(
	channel: string | undefined,
	onInvalidate: () => void,
	client: RealtimeClient = realtimeClient,
): void {
	const onInvalidateRef = useRef(onInvalidate);
	onInvalidateRef.current = onInvalidate;

	useEffect(() => {
		if (!channel) {
			return undefined;
		}

		return client.subscribe(channel, () => onInvalidateRef.current());
	}, [channel, client]);
}
