/**
 * One random id generated per browser tab (module-scoped, so every import in this page's JS realm sees the
 * same value for the lifetime of the tab) -- shared between `ws.ts` (sent on the WS handshake as `?clientId=`)
 * and `fetch.ts` (sent as the `RealtimeClientIdHeader` on every request) so a mutation this tab makes can be
 * correlated with the WS connection this same tab already holds.
 *
 * This deliberately can't just be the session's user id (the WS ticket's `sub`, `wsTicket.ts`): `sub` identifies
 * who is logged in, which is the same value across every tab/device that user happens to have open at once.
 * If a mod has two tabs open on the same AMA and denies a question in tab A, tab A already knows the result (its
 * own mutation's `onSuccess` already invalidated its cache) and should skip the resulting gateway signal to
 * avoid a redundant refetch -- but tab B has no idea anything changed yet and must still receive it. Filtering
 * on `sub` would incorrectly suppress the signal for tab B too, since it's the same user. This id exists
 * specifically to distinguish which connection caused a change, not which user -- so suppression happens at
 * the single tab that already knows, and nowhere else.
 */
export const REALTIME_CLIENT_ID: string | undefined = typeof window === 'undefined' ? undefined : crypto.randomUUID();
