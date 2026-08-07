'use client';

import { useEffect, useRef } from 'react';
import { realtimeClient } from '@/api/ws';

/**
 * Subscribes to a WS gateway channel (`@chatsift/core`'s `realtimeChannels.ts` builders) for the lifetime of
 * the component, re-running `onInvalidate` (a TanStack Query cache invalidation, typically) whenever the
 * server signals something on that channel changed. `onInvalidate` is read through a ref so callers don't need
 * to memoize it themselves.
 */
export function useRealtimeInvalidate(channel: string | undefined, onInvalidate: () => void): void {
	const onInvalidateRef = useRef(onInvalidate);
	onInvalidateRef.current = onInvalidate;

	useEffect(() => {
		if (!channel) {
			return undefined;
		}

		return realtimeClient.subscribe(channel, () => onInvalidateRef.current());
	}, [channel]);
}
