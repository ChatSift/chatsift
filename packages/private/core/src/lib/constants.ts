export const BOTS = ['AMA', 'MODMAIL'] as const;

export type BotId = (typeof BOTS)[number];

export const NewAccessTokenHeader = 'X-Update-Access-Token' as const;
export const RefreshTokenCookie = 'refresh_token' as const;
