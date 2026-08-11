// Order is load-bearing for presentation only (the dashboard's guild nav and the homepage's bot grid both
// map over this). 'SOCIAL' (#343) is a real BotId from its API phase onward -- what it does *not* have yet is
// public marketing copy, which is why `apps/website`'s `marketingBots` is a partial record keyed off this and
// the public pages render only the bots that have an entry (see that file).
export const BOTS = ['AMA', 'MODMAIL', 'SOCIAL'] as const;

export type BotId = (typeof BOTS)[number];

export const NewAccessTokenHeader = 'X-Update-Access-Token' as const;
export const RefreshTokenCookie = 'refresh_token' as const;

/**
 * Carries the WS gateway's per-tab `realtimeClientId` (`apps/website/src/api/realtimeClientId.ts`) on an HTTP
 * mutation request, so `services/api/src/core/server.ts`'s `realtimeChannel` broadcast hook can tag the
 * resulting invalidate signal with which browser tab caused it -- see that file's doc comment for why this has
 * to be a value separate from the session's user id.
 */
export const RealtimeClientIdHeader = 'X-Realtime-Client-Id' as const;
