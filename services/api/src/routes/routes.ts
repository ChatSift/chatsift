// This file should exclusively re-export the default exports from each route file

export { default as CreateAMA } from './ama/createAMA.js';
export { default as GetAMA } from './ama/getAMA.js';
export { default as GetAMAs } from './ama/getAMAs.js';
export { default as UpdateAMA } from './ama/updateAMA.js';
export { default as RepostPrompt } from './ama/repostPrompt.js';

export { default as GetAuthDiscord } from './auth/discord.js';
export { default as GetAuthDiscordCallback } from './auth/discordCallback.js';
export { default as PostAuthLogout } from './auth/logout.js';
export { default as GetAuthMe } from './auth/me.js';

export { default as GetGuild } from './guilds/get.js';
