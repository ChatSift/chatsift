export const BOTS = ['AMA', 'MODMAIL'] as const;

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
