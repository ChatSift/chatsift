// This file should exclusively re-export the default exports from each route file
//
// AMA routes (createAMA/getAMA/getAMAs/updateAMA/repostPrompt) are intentionally absent — they've been migrated to
// `defineRoute` (docs/roadmap/02-foundation.md Part C, #128) and no longer fit this `Route`-subclass reflection
// barrel. Their frontend types are unavailable until #131 replaces apps/website/src/data/* with src/api/*.

export { default as GetAuthDiscord } from './auth/discord.js';
export { default as GetAuthDiscordCallback } from './auth/discordCallback.js';
export { default as PostAuthLogout } from './auth/logout.js';
export { default as GetAuthMe } from './auth/me.js';

export { default as GetGuild } from './guilds/get.js';
export { default as CreateGrant } from './guilds/createGrant.js';
export { default as DeleteGrant } from './guilds/deleteGrant.js';
export { default as GetGrants } from './guilds/getGrants.js';
