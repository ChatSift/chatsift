'use client';

import { useRef } from 'react';
import type { RealtimeClient } from '@/api/ws';
import { createPublicRealtimeClient } from '@/api/ws';

/**
 * The gateway client an unauthenticated page uses (#323), created once per ticket endpoint and kept stable for
 * as long as that endpoint is the one on screen -- `useRealtimeInvalidate` tears down and re-subscribes
 * whenever the client identity changes, so an unstable reference would churn a socket per render.
 *
 * A ref rather than `useMemo` because this is a correctness requirement, not a performance one: React is free
 * to discard a `useMemo` result whenever it likes. Keyed on the path rather than created once for the
 * component's lifetime because the App Router reuses these components across navigations within the same route
 * -- only the param changes, so a lifetime-scoped client would keep minting tickets for the previous AMA or
 * guild. The outgoing client needs no explicit teardown: its socket closes on its own once the last
 * subscription drops, which the re-subscribe on the next render triggers.
 */
export function usePublicRealtimeClient(ticketPath: string): RealtimeClient {
	const ref = useRef<{ client: RealtimeClient; ticketPath: string } | null>(null);

	if (ref.current?.ticketPath !== ticketPath) {
		ref.current = { client: createPublicRealtimeClient(ticketPath), ticketPath };
	}

	return ref.current.client;
}
