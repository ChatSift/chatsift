/**
 * For frontend types, the API is written like a package. This file is NOT the entry point for the API server
 * itself — see `bin.ts` for that (which hands off to `app.ts` for the actual polka setup once the context is
 * initialized). This file exports the route definitions + shared core types for `apps/website` to derive its
 * request/response contracts from via `InferRouteContract<typeof someRoute>` — no `routesInfo` mirror needed.
 */

export type { InferRouteContract } from './core/contract.js';
export type { HttpMethod, RouteDefinition, RouteSchema, TypedRequest } from './core/route.js';

export { default as createAMARoute } from './routes/ama/createAMA.js';
export { default as exportAMARoute } from './routes/ama/exportAMA.js';
export { default as getAMARoute } from './routes/ama/getAMA.js';
export { default as getAMAStatsRoute } from './routes/ama/getAMAStats.js';
export { default as getAMAsRoute } from './routes/ama/getAMAs.js';
export { default as repostPromptRoute } from './routes/ama/repostPrompt.js';
export { default as updateAMARoute } from './routes/ama/updateAMA.js';

export { default as discordRoute } from './routes/auth/discord.js';
export { default as discordCallbackRoute } from './routes/auth/discordCallback.js';
export { default as logoutRoute } from './routes/auth/logout.js';
export { default as meRoute } from './routes/auth/me.js';

export { default as createGrantRoute } from './routes/guilds/createGrant.js';
export { default as deleteGrantRoute } from './routes/guilds/deleteGrant.js';
export { default as getGuildRoute } from './routes/guilds/get.js';
export type { GuildChannelInfo, GuildRoleInfo, PossiblyMissingChannelInfo } from './routes/guilds/get.js';
export { default as getGrantsRoute } from './routes/guilds/getGrants.js';
export type { Grant } from './routes/guilds/getGrants.js';

export { default as getModmailConfigRoute } from './routes/modmail/config/getConfig.js';
export { default as updateModmailConfigRoute } from './routes/modmail/config/updateConfig.js';

export { default as createModmailCategoryRoute } from './routes/modmail/categories/createCategory.js';
export { default as deleteModmailCategoryRoute } from './routes/modmail/categories/deleteCategory.js';
export { default as listModmailCategoriesRoute } from './routes/modmail/categories/listCategories.js';
export { default as updateModmailCategoryRoute } from './routes/modmail/categories/updateCategory.js';

export { default as createModmailPanelRoute } from './routes/modmail/panels/createPanel.js';
export { default as deleteModmailPanelRoute } from './routes/modmail/panels/deletePanel.js';
export { default as listModmailPanelsRoute } from './routes/modmail/panels/listPanels.js';
export { default as updateModmailPanelRoute } from './routes/modmail/panels/updatePanel.js';

export { default as createModmailSnippetRoute } from './routes/modmail/snippets/createSnippet.js';
export { default as deleteModmailSnippetRoute } from './routes/modmail/snippets/deleteSnippet.js';
export { default as listModmailSnippetsRoute } from './routes/modmail/snippets/listSnippets.js';
export { default as updateModmailSnippetRoute } from './routes/modmail/snippets/updateSnippet.js';

export { default as createModmailBlockRoute } from './routes/modmail/blocks/createBlock.js';
export { default as deleteModmailBlockRoute } from './routes/modmail/blocks/deleteBlock.js';
export { default as listModmailBlocksRoute } from './routes/modmail/blocks/listBlocks.js';

export { default as getModmailThreadRoute } from './routes/modmail/threads/getThread.js';
export { default as listModmailThreadsRoute } from './routes/modmail/threads/listThreads.js';
