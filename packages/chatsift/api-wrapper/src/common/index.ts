import type { RESTAPIPartialCurrentUserGuild, APIGuild } from 'discord-api-types/v9';

export * from './bitfields';
export * from './rest';
export * from './schemas';

export type UserGuild = RESTAPIPartialCurrentUserGuild & { data: APIGuild | null };
