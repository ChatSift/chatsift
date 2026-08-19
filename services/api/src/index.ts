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

export { default as listAMAQuestionsRoute } from './routes/ama/questions/listQuestions.js';
export { default as getAMAQuestionRoute } from './routes/ama/questions/getQuestion.js';
export { default as updateAMAQuestionRoute } from './routes/ama/questions/updateQuestion.js';
export { default as sendAMAQuestionRoute } from './routes/ama/questions/sendQuestion.js';
export { default as mergeAMAQuestionRoute } from './routes/ama/questions/mergeQuestion.js';
export { default as mergeAMAQuestionsBulkRoute } from './routes/ama/questions/mergeQuestionsBulk.js';
export { default as publicAMAAnswersRoute } from './routes/ama/questions/publicAnswers.js';
export { default as publicAMAWsTicketRoute } from './routes/ama/questions/publicWsTicket.js';

export { default as listAMATagsRoute } from './routes/ama/tags/listTags.js';
export { default as createAMATagRoute } from './routes/ama/tags/createTag.js';
export { default as deleteAMATagRoute } from './routes/ama/tags/deleteTag.js';

export { default as dashboardLinkRoute } from './routes/auth/dashboardLink.js';
export { default as discordRoute } from './routes/auth/discord.js';
export { default as discordCallbackRoute } from './routes/auth/discordCallback.js';
export { default as logoutRoute } from './routes/auth/logout.js';
export { default as meRoute } from './routes/auth/me.js';

export { default as createGrantRoute } from './routes/guilds/createGrant.js';
export { default as deleteGrantRoute } from './routes/guilds/deleteGrant.js';
export { default as getGuildRoute } from './routes/guilds/get.js';
export type {
	GuildChannelInfo,
	GuildEmojiInfo,
	GuildRoleInfo,
	PossiblyMissingChannelInfo,
} from './routes/guilds/get.js';
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
export { default as resyncModmailPanelsRoute } from './routes/modmail/panels/resyncPanels.js';
export { default as updateModmailPanelRoute } from './routes/modmail/panels/updatePanel.js';

export { default as createModmailSnippetRoute } from './routes/modmail/snippets/createSnippet.js';
export { default as deleteModmailSnippetRoute } from './routes/modmail/snippets/deleteSnippet.js';
export { default as getModmailSnippetUpdatesRoute } from './routes/modmail/snippets/getSnippetUpdates.js';
export type {
	SnippetRevision,
	SnippetRevisionField,
	SnippetRevisionsResult,
} from './routes/modmail/snippets/getSnippetUpdates.js';
export { default as listModmailSnippetsRoute } from './routes/modmail/snippets/listSnippets.js';
export { default as resyncModmailSnippetsRoute } from './routes/modmail/snippets/resyncSnippets.js';
export { default as updateModmailSnippetRoute } from './routes/modmail/snippets/updateSnippet.js';

export { default as createModmailBlockRoute } from './routes/modmail/blocks/createBlock.js';
export { default as deleteModmailBlockRoute } from './routes/modmail/blocks/deleteBlock.js';
export { default as listModmailBlocksRoute } from './routes/modmail/blocks/listBlocks.js';

export { default as getModmailThreadRoute } from './routes/modmail/threads/getThread.js';
export { default as getModmailThreadMessageEditsRoute } from './routes/modmail/threads/getMessageEdits.js';
export { default as listModmailThreadsRoute } from './routes/modmail/threads/listThreads.js';

export { default as getSocialConfigRoute } from './routes/social/config/getConfig.js';
export { default as updateSocialConfigRoute } from './routes/social/config/updateConfig.js';

export { default as deleteSocialChannelRoute } from './routes/social/channels/deleteChannel.js';
export { default as listSocialChannelsRoute } from './routes/social/channels/listChannels.js';
export { default as upsertSocialChannelRoute } from './routes/social/channels/upsertChannel.js';

export { default as deleteSocialRoleRoute } from './routes/social/roles/deleteRole.js';
export { default as listSocialRolesRoute } from './routes/social/roles/listRoles.js';
export { default as upsertSocialRoleRoute } from './routes/social/roles/upsertRole.js';

export { default as deleteSocialRewardRoute } from './routes/social/rewards/deleteReward.js';
export { default as listSocialRewardsRoute } from './routes/social/rewards/listRewards.js';
export { default as upsertSocialRewardRoute } from './routes/social/rewards/upsertReward.js';

export { default as listSocialLeaderboardRoute } from './routes/social/leaderboard/listLeaderboard.js';
export { default as publicSocialLeaderboardRoute } from './routes/social/leaderboard/publicLeaderboard.js';
export { default as publicSocialLeaderboardWsTicketRoute } from './routes/social/leaderboard/publicWsTicket.js';

export { default as createSocialInteractionRoute } from './routes/social/interactions/createInteraction.js';
export { default as deleteSocialInteractionRoute } from './routes/social/interactions/deleteInteraction.js';
export { default as listSocialInteractionsRoute } from './routes/social/interactions/listInteractions.js';
export { default as resyncSocialInteractionsRoute } from './routes/social/interactions/resyncInteractions.js';
export { default as updateSocialInteractionRoute } from './routes/social/interactions/updateInteraction.js';

export { default as getAutomoderatorConfigRoute } from './routes/automoderator/config/getConfig.js';
export { default as updateAutomoderatorConfigRoute } from './routes/automoderator/config/updateConfig.js';
export { default as listAutomoderatorCasesRoute } from './routes/automoderator/cases/listCases.js';
export { default as getAutomoderatorCaseRoute } from './routes/automoderator/cases/getCase.js';
export { default as updateAutomoderatorCaseRoute } from './routes/automoderator/cases/updateCase.js';
export { default as deleteAutomoderatorCaseRoute } from './routes/automoderator/cases/deleteCase.js';
export { default as listAutomoderatorLogChannelsRoute } from './routes/automoderator/logChannels/listLogChannels.js';
export { default as setAutomoderatorLogChannelRoute } from './routes/automoderator/logChannels/setLogChannel.js';
export { default as deleteAutomoderatorLogChannelRoute } from './routes/automoderator/logChannels/deleteLogChannel.js';
export { default as listAutomoderatorLogExemptionsRoute } from './routes/automoderator/logExemptions/listLogExemptions.js';
export { default as setAutomoderatorLogExemptionRoute } from './routes/automoderator/logExemptions/setLogExemption.js';
export { default as deleteAutomoderatorLogExemptionRoute } from './routes/automoderator/logExemptions/deleteLogExemption.js';
export { default as automoderatorPublicHistoryRoute } from './routes/automoderator/publicHistory.js';
export { default as listAutomoderatorReportsRoute } from './routes/automoderator/reports/listReports.js';
export { default as getAutomoderatorReportRoute } from './routes/automoderator/reports/getReport.js';
export { default as getAutomoderatorReportDraftRoute } from './routes/automoderator/reports/getReportDraft.js';
export { default as submitAutomoderatorReportDraftRoute } from './routes/automoderator/reports/submitReportDraft.js';
export { default as listAutomoderatorReportPresetsRoute } from './routes/automoderator/reportPresets/listPresets.js';
export { default as createAutomoderatorReportPromptRoute } from './routes/automoderator/reportPrompts/createReportPrompt.js';
export { default as deleteAutomoderatorReportPromptRoute } from './routes/automoderator/reportPrompts/deleteReportPrompt.js';
export { default as listAutomoderatorReportPromptsRoute } from './routes/automoderator/reportPrompts/listReportPrompts.js';
export { default as updateAutomoderatorReportPromptRoute } from './routes/automoderator/reportPrompts/updateReportPrompt.js';
export { default as createAutomoderatorReportPresetRoute } from './routes/automoderator/reportPresets/createPreset.js';
export { default as updateAutomoderatorReportPresetRoute } from './routes/automoderator/reportPresets/updatePreset.js';
export { default as deleteAutomoderatorReportPresetRoute } from './routes/automoderator/reportPresets/deletePreset.js';
export { default as listAutomoderatorWarnPunishmentsRoute } from './routes/automoderator/warnPunishments/listWarnPunishments.js';
export { default as setAutomoderatorWarnPunishmentRoute } from './routes/automoderator/warnPunishments/setWarnPunishment.js';
export { default as deleteAutomoderatorWarnPunishmentRoute } from './routes/automoderator/warnPunishments/deleteWarnPunishment.js';

export { default as listExperimentsRoute } from './routes/experiments/listExperiments.js';
export type { ExperimentWithOverrides } from './routes/experiments/listExperiments.js';
export { default as upsertExperimentRoute } from './routes/experiments/upsertExperiment.js';
export { default as deleteExperimentRoute } from './routes/experiments/deleteExperiment.js';

export { default as getWsTicketRoute } from './routes/ws/getTicket.js';
