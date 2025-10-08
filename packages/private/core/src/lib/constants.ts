export const BOTS = ['AMA'] as const;

export type BotId = (typeof BOTS)[number];

export const NewAccessTokenHeader = 'X-Update-Access-Token' as const;
