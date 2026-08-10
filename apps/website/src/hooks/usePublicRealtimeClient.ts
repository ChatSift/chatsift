'use client';

import { useRef } from 'react';
import type { RealtimeClient } from '@/api/ws';
import { createPublicRealtimeClient } from '@/api/ws';

/**
 * The public answers page's gateway client (#323), created once per share token and kept stable for as long as
 * that token is the one on screen -- `useRealtimeInvalidate` tears down and re-subscribes whenever the client
 * identity changes, so an unstable reference would churn a socket per render.
 *
 * A ref rather than `useMemo` because this is a correctness requirement, not a performance one: React is free
 * to discard a `useMemo` result whenever it likes. Keyed on the token rather than created once for the
 * component's lifetime because the App Router reuses this component across `/ama-answers/[shareToken]`
 * navigations -- only the param changes, so a lifetime-scoped client would keep minting tickets for the
 * previous AMA. The outgoing client needs no explicit teardown: its socket closes on its own once the last
 * subscription drops, which the re-subscribe on the next render triggers.
 */
export function usePublicRealtimeClient(shareToken: string): RealtimeClient {
	const ref = useRef<{ client: RealtimeClient; shareToken: string } | null>(null);

	if (ref.current?.shareToken !== shareToken) {
		ref.current = { client: createPublicRealtimeClient(shareToken), shareToken };
	}

	return ref.current.client;
}
