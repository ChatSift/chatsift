/**
 * Actual runtime polka app assembly. Imported dynamically from `bin.ts` *after* `initContext()` has run — several
 * route modules (transitively, via `util/discordAPI.js`) read `getContext().env` at module-load time, so they
 * can't be statically imported before the context exists.
 */

import { createServer } from 'node:http';
import { getContext, NewAccessTokenHeader } from '@chatsift/backend-core';
import { Boom, isBoom, notFound } from '@hapi/boom';
import cors from 'cors';
import helmet from 'helmet';
import type { Middleware } from 'polka';
import polka from 'polka';
import { mountRoute } from './core/server.js';
import { attachHttpUtils } from './middleware/attachHttpUtils.js';
import { attachLogger } from './middleware/attachLogger.js';
import createAMARoute from './routes/ama/createAMA.js';
import exportAMARoute from './routes/ama/exportAMA.js';
import getAMARoute from './routes/ama/getAMA.js';
import getAMAStatsRoute from './routes/ama/getAMAStats.js';
import getAMAsRoute from './routes/ama/getAMAs.js';
import getAMAQuestionRoute from './routes/ama/questions/getQuestion.js';
import listAMAQuestionsRoute from './routes/ama/questions/listQuestions.js';
import mergeAMAQuestionRoute from './routes/ama/questions/mergeQuestion.js';
import mergeAMAQuestionsBulkRoute from './routes/ama/questions/mergeQuestionsBulk.js';
import publicAMAAnswersRoute from './routes/ama/questions/publicAnswers.js';
import publicAMAWsTicketRoute from './routes/ama/questions/publicWsTicket.js';
import sendAMAQuestionRoute from './routes/ama/questions/sendQuestion.js';
import updateAMAQuestionRoute from './routes/ama/questions/updateQuestion.js';
import repostPromptRoute from './routes/ama/repostPrompt.js';
import createAMATagRoute from './routes/ama/tags/createTag.js';
import deleteAMATagRoute from './routes/ama/tags/deleteTag.js';
import listAMATagsRoute from './routes/ama/tags/listTags.js';
import updateAMARoute from './routes/ama/updateAMA.js';
import dashboardLinkRoute from './routes/auth/dashboardLink.js';
import discordRoute from './routes/auth/discord.js';
import discordCallbackRoute from './routes/auth/discordCallback.js';
import logoutRoute from './routes/auth/logout.js';
import meRoute from './routes/auth/me.js';
import createAllowedInviteRoute from './routes/automoderator/allowedInvites/createAllowedInvite.js';
import deleteAllowedInviteRoute from './routes/automoderator/allowedInvites/deleteAllowedInvite.js';
import listAllowedInvitesRoute from './routes/automoderator/allowedInvites/listAllowedInvites.js';
import createAllowedUrlRoute from './routes/automoderator/allowedUrls/createAllowedUrl.js';
import deleteAllowedUrlRoute from './routes/automoderator/allowedUrls/deleteAllowedUrl.js';
import listAllowedUrlsRoute from './routes/automoderator/allowedUrls/listAllowedUrls.js';
import listAutomodRulesRoute from './routes/automoderator/automodRules/listAutomodRules.js';
import deleteBanwordPolicyRoute from './routes/automoderator/banwordPolicies/deleteBanwordPolicy.js';
import listBanwordPoliciesRoute from './routes/automoderator/banwordPolicies/listBanwordPolicies.js';
import setBanwordPolicyRoute from './routes/automoderator/banwordPolicies/setBanwordPolicy.js';
import deleteBypassRoleRoute from './routes/automoderator/bypassRoles/deleteBypassRole.js';
import listBypassRolesRoute from './routes/automoderator/bypassRoles/listBypassRoles.js';
import setBypassRoleRoute from './routes/automoderator/bypassRoles/setBypassRole.js';
import deleteAutomoderatorCaseRoute from './routes/automoderator/cases/deleteCase.js';
import getAutomoderatorCaseRoute from './routes/automoderator/cases/getCase.js';
import listAutomoderatorCasesRoute from './routes/automoderator/cases/listCases.js';
import updateAutomoderatorCaseRoute from './routes/automoderator/cases/updateCase.js';
import getAutomoderatorConfigRoute from './routes/automoderator/config/getConfig.js';
import updateAutomoderatorConfigRoute from './routes/automoderator/config/updateConfig.js';
import deleteFilterExemptionRoute from './routes/automoderator/filterExemptions/deleteFilterExemption.js';
import listFilterExemptionsRoute from './routes/automoderator/filterExemptions/listFilterExemptions.js';
import setFilterExemptionRoute from './routes/automoderator/filterExemptions/setFilterExemption.js';
import deleteAutomoderatorLogChannelRoute from './routes/automoderator/logChannels/deleteLogChannel.js';
import listAutomoderatorLogChannelsRoute from './routes/automoderator/logChannels/listLogChannels.js';
import setAutomoderatorLogChannelRoute from './routes/automoderator/logChannels/setLogChannel.js';
import deleteAutomoderatorLogExemptionRoute from './routes/automoderator/logExemptions/deleteLogExemption.js';
import listAutomoderatorLogExemptionsRoute from './routes/automoderator/logExemptions/listLogExemptions.js';
import setAutomoderatorLogExemptionRoute from './routes/automoderator/logExemptions/setLogExemption.js';
import automoderatorPublicHistoryRoute from './routes/automoderator/publicHistory.js';
import createAutomoderatorReportPresetRoute from './routes/automoderator/reportPresets/createPreset.js';
import deleteAutomoderatorReportPresetRoute from './routes/automoderator/reportPresets/deletePreset.js';
import listAutomoderatorReportPresetsRoute from './routes/automoderator/reportPresets/listPresets.js';
import updateAutomoderatorReportPresetRoute from './routes/automoderator/reportPresets/updatePreset.js';
import createAutomoderatorReportPromptRoute from './routes/automoderator/reportPrompts/createReportPrompt.js';
import deleteAutomoderatorReportPromptRoute from './routes/automoderator/reportPrompts/deleteReportPrompt.js';
import listAutomoderatorReportPromptsRoute from './routes/automoderator/reportPrompts/listReportPrompts.js';
import updateAutomoderatorReportPromptRoute from './routes/automoderator/reportPrompts/updateReportPrompt.js';
import getAutomoderatorReportRoute from './routes/automoderator/reports/getReport.js';
import getAutomoderatorReportDraftRoute from './routes/automoderator/reports/getReportDraft.js';
import listAutomoderatorReportsRoute from './routes/automoderator/reports/listReports.js';
import submitAutomoderatorReportDraftRoute from './routes/automoderator/reports/submitReportDraft.js';
import deleteAutomoderatorWarnPunishmentRoute from './routes/automoderator/warnPunishments/deleteWarnPunishment.js';
import listAutomoderatorWarnPunishmentsRoute from './routes/automoderator/warnPunishments/listWarnPunishments.js';
import setAutomoderatorWarnPunishmentRoute from './routes/automoderator/warnPunishments/setWarnPunishment.js';
import dozzleWebhookRoute from './routes/dozzle/webhook.js';
import deleteExperimentRoute from './routes/experiments/deleteExperiment.js';
import listExperimentsRoute from './routes/experiments/listExperiments.js';
import upsertExperimentRoute from './routes/experiments/upsertExperiment.js';
import createGrantRoute from './routes/guilds/createGrant.js';
import deleteGrantRoute from './routes/guilds/deleteGrant.js';
import getGuildRoute from './routes/guilds/get.js';
import getGrantsRoute from './routes/guilds/getGrants.js';
import metricsRoute from './routes/metrics/metrics.js';
import createBlockRoute from './routes/modmail/blocks/createBlock.js';
import deleteBlockRoute from './routes/modmail/blocks/deleteBlock.js';
import listBlocksRoute from './routes/modmail/blocks/listBlocks.js';
import createCategoryRoute from './routes/modmail/categories/createCategory.js';
import deleteCategoryRoute from './routes/modmail/categories/deleteCategory.js';
import listCategoriesRoute from './routes/modmail/categories/listCategories.js';
import updateCategoryRoute from './routes/modmail/categories/updateCategory.js';
import getConfigRoute from './routes/modmail/config/getConfig.js';
import updateConfigRoute from './routes/modmail/config/updateConfig.js';
import createPanelRoute from './routes/modmail/panels/createPanel.js';
import deletePanelRoute from './routes/modmail/panels/deletePanel.js';
import listPanelsRoute from './routes/modmail/panels/listPanels.js';
import resyncPanelsRoute from './routes/modmail/panels/resyncPanels.js';
import updatePanelRoute from './routes/modmail/panels/updatePanel.js';
import createSnippetRoute from './routes/modmail/snippets/createSnippet.js';
import deleteSnippetRoute from './routes/modmail/snippets/deleteSnippet.js';
import getSnippetUpdatesRoute from './routes/modmail/snippets/getSnippetUpdates.js';
import listSnippetsRoute from './routes/modmail/snippets/listSnippets.js';
import resyncSnippetsRoute from './routes/modmail/snippets/resyncSnippets.js';
import updateSnippetRoute from './routes/modmail/snippets/updateSnippet.js';
import getThreadMessageEditsRoute from './routes/modmail/threads/getMessageEdits.js';
import getThreadRoute from './routes/modmail/threads/getThread.js';
import listThreadsRoute from './routes/modmail/threads/listThreads.js';
import deleteSocialChannelRoute from './routes/social/channels/deleteChannel.js';
import listSocialChannelsRoute from './routes/social/channels/listChannels.js';
import upsertSocialChannelRoute from './routes/social/channels/upsertChannel.js';
import getSocialConfigRoute from './routes/social/config/getConfig.js';
import updateSocialConfigRoute from './routes/social/config/updateConfig.js';
import createSocialInteractionRoute from './routes/social/interactions/createInteraction.js';
import deleteSocialInteractionRoute from './routes/social/interactions/deleteInteraction.js';
import listSocialInteractionsRoute from './routes/social/interactions/listInteractions.js';
import resyncSocialInteractionsRoute from './routes/social/interactions/resyncInteractions.js';
import updateSocialInteractionRoute from './routes/social/interactions/updateInteraction.js';
import listSocialLeaderboardRoute from './routes/social/leaderboard/listLeaderboard.js';
import publicSocialLeaderboardRoute from './routes/social/leaderboard/publicLeaderboard.js';
import publicSocialLeaderboardWsTicketRoute from './routes/social/leaderboard/publicWsTicket.js';
import deleteSocialRewardRoute from './routes/social/rewards/deleteReward.js';
import listSocialRewardsRoute from './routes/social/rewards/listRewards.js';
import upsertSocialRewardRoute from './routes/social/rewards/upsertReward.js';
import deleteSocialRoleRoute from './routes/social/roles/deleteRole.js';
import listSocialRolesRoute from './routes/social/roles/listRoles.js';
import upsertSocialRoleRoute from './routes/social/roles/upsertRole.js';
import getWsTicketRoute from './routes/ws/getTicket.js';
import { sendBoom } from './util/sendBoom.js';
import { attachWebSocketServer } from './ws/server.js';

export async function startServer(): Promise<void> {
	// Constructed explicitly (rather than letting polka create its own via `app.listen()`) so the WS gateway
	// can hook `upgrade` on it before the server starts listening -- polka is a thin router over a plain
	// `http.Server` under the hood, so passing one in via `server:` and later calling `app.listen()` is
	// equivalent to polka's own default, just with a reference available up front.
	const httpServer = createServer();

	const app = polka({
		server: httpServer,
		onError(err, req, res) {
			// req.logger is set by attachLogger(), the very first `.use()` middleware -- it's only absent here if
			// something throws before any `.use()` middleware ran at all (e.g. polka's own routing/parsing).
			const logger = req.logger ?? getContext().logger;
			const boom = isBoom(err) ? err : new Boom(err);

			if (boom.output.statusCode === 500) {
				logger.error({ err: boom }, boom.message);
			} else {
				logger.warn({ err: boom }, boom.message);
			}

			if (res.writableEnded) {
				return;
			}

			if (res.headersSent) {
				logger.warn('weird edge case we have no clue how to handle');
				res.end();
				return;
			}

			res.setHeader('content-type', 'application/json');
			sendBoom(boom, res);
		},
		onNoMatch(req, res) {
			// req.logger is set by attachLogger(), the very first `.use()` middleware -- see the same fallback note
			// on `onError` above for the one case it can still be missing.
			(req.logger ?? getContext().logger).warn({ method: req.method, path: req.path }, 'no route matched');

			res.setHeader('content-type', 'application/json');
			sendBoom(notFound(), res);
		},
	}).use(
		attachLogger(),
		cors({
			origin: getContext().env.CORS,
			credentials: true,
			exposedHeaders: [NewAccessTokenHeader],
		}),
		helmet(getContext().env.IS_PRODUCTION ? {} : { contentSecurityPolicy: false }) as Middleware,
		attachHttpUtils(),
	);

	await attachWebSocketServer(httpServer);

	// Each call is instantiated against its own route's middleware tuple — folding these into a loop over an array
	// literal would force TS to unify all of them under one `TMiddlewares` instantiation, which doesn't typecheck
	// (see the `unwrapMiddlewareHandle` doc comment in `core/route.ts` for the same heterogeneous-tuple issue).
	mountRoute(app, createAMARoute);
	mountRoute(app, exportAMARoute);
	mountRoute(app, getAMARoute);
	mountRoute(app, getAMAStatsRoute);
	mountRoute(app, getAMAsRoute);
	mountRoute(app, repostPromptRoute);
	mountRoute(app, updateAMARoute);
	mountRoute(app, listAMAQuestionsRoute);
	mountRoute(app, getAMAQuestionRoute);
	mountRoute(app, updateAMAQuestionRoute);
	mountRoute(app, sendAMAQuestionRoute);
	mountRoute(app, mergeAMAQuestionRoute);
	mountRoute(app, mergeAMAQuestionsBulkRoute);
	mountRoute(app, publicAMAAnswersRoute);
	mountRoute(app, publicAMAWsTicketRoute);
	mountRoute(app, listAMATagsRoute);
	mountRoute(app, createAMATagRoute);
	mountRoute(app, deleteAMATagRoute);
	mountRoute(app, discordRoute);
	mountRoute(app, dashboardLinkRoute);
	mountRoute(app, discordCallbackRoute);
	mountRoute(app, logoutRoute);
	mountRoute(app, meRoute);
	mountRoute(app, createGrantRoute);
	mountRoute(app, deleteGrantRoute);
	mountRoute(app, getGuildRoute);
	mountRoute(app, getGrantsRoute);
	mountRoute(app, dozzleWebhookRoute);
	mountRoute(app, metricsRoute);
	mountRoute(app, getConfigRoute);
	mountRoute(app, updateConfigRoute);
	mountRoute(app, listCategoriesRoute);
	mountRoute(app, createCategoryRoute);
	mountRoute(app, updateCategoryRoute);
	mountRoute(app, deleteCategoryRoute);
	mountRoute(app, listPanelsRoute);
	mountRoute(app, createPanelRoute);
	mountRoute(app, updatePanelRoute);
	mountRoute(app, deletePanelRoute);
	mountRoute(app, resyncPanelsRoute);
	mountRoute(app, listSnippetsRoute);
	mountRoute(app, getSnippetUpdatesRoute);
	mountRoute(app, createSnippetRoute);
	mountRoute(app, updateSnippetRoute);
	mountRoute(app, deleteSnippetRoute);
	mountRoute(app, resyncSnippetsRoute);
	mountRoute(app, listBlocksRoute);
	mountRoute(app, createBlockRoute);
	mountRoute(app, deleteBlockRoute);
	mountRoute(app, listThreadsRoute);
	mountRoute(app, getThreadRoute);
	mountRoute(app, getThreadMessageEditsRoute);
	mountRoute(app, getSocialConfigRoute);
	mountRoute(app, updateSocialConfigRoute);
	mountRoute(app, listSocialChannelsRoute);
	mountRoute(app, upsertSocialChannelRoute);
	mountRoute(app, deleteSocialChannelRoute);
	mountRoute(app, listSocialRolesRoute);
	mountRoute(app, upsertSocialRoleRoute);
	mountRoute(app, deleteSocialRoleRoute);
	mountRoute(app, listSocialRewardsRoute);
	mountRoute(app, upsertSocialRewardRoute);
	mountRoute(app, deleteSocialRewardRoute);
	mountRoute(app, listSocialInteractionsRoute);
	mountRoute(app, createSocialInteractionRoute);
	mountRoute(app, updateSocialInteractionRoute);
	mountRoute(app, deleteSocialInteractionRoute);
	mountRoute(app, resyncSocialInteractionsRoute);
	mountRoute(app, listSocialLeaderboardRoute);
	mountRoute(app, publicSocialLeaderboardRoute);
	mountRoute(app, publicSocialLeaderboardWsTicketRoute);
	mountRoute(app, getAutomoderatorConfigRoute);
	mountRoute(app, updateAutomoderatorConfigRoute);
	mountRoute(app, listAutomoderatorCasesRoute);
	mountRoute(app, getAutomoderatorCaseRoute);
	mountRoute(app, updateAutomoderatorCaseRoute);
	mountRoute(app, deleteAutomoderatorCaseRoute);
	mountRoute(app, listAutomoderatorLogChannelsRoute);
	mountRoute(app, setAutomoderatorLogChannelRoute);
	mountRoute(app, deleteAutomoderatorLogChannelRoute);
	mountRoute(app, listAutomoderatorLogExemptionsRoute);
	mountRoute(app, setAutomoderatorLogExemptionRoute);
	mountRoute(app, deleteAutomoderatorLogExemptionRoute);
	mountRoute(app, automoderatorPublicHistoryRoute);
	mountRoute(app, listAutomoderatorReportsRoute);
	mountRoute(app, getAutomoderatorReportRoute);
	mountRoute(app, getAutomoderatorReportDraftRoute);
	mountRoute(app, submitAutomoderatorReportDraftRoute);
	mountRoute(app, createAutomoderatorReportPromptRoute);
	mountRoute(app, deleteAutomoderatorReportPromptRoute);
	mountRoute(app, listAutomoderatorReportPromptsRoute);
	mountRoute(app, updateAutomoderatorReportPromptRoute);
	mountRoute(app, listAutomoderatorReportPresetsRoute);
	mountRoute(app, createAutomoderatorReportPresetRoute);
	mountRoute(app, updateAutomoderatorReportPresetRoute);
	mountRoute(app, deleteAutomoderatorReportPresetRoute);
	mountRoute(app, listAutomoderatorWarnPunishmentsRoute);
	mountRoute(app, setAutomoderatorWarnPunishmentRoute);
	mountRoute(app, deleteAutomoderatorWarnPunishmentRoute);
	mountRoute(app, listAutomodRulesRoute);
	mountRoute(app, listBanwordPoliciesRoute);
	mountRoute(app, setBanwordPolicyRoute);
	mountRoute(app, deleteBanwordPolicyRoute);
	mountRoute(app, listBypassRolesRoute);
	mountRoute(app, setBypassRoleRoute);
	mountRoute(app, deleteBypassRoleRoute);

	mountRoute(app, listAllowedUrlsRoute);
	mountRoute(app, createAllowedUrlRoute);
	mountRoute(app, deleteAllowedUrlRoute);

	mountRoute(app, listAllowedInvitesRoute);
	mountRoute(app, createAllowedInviteRoute);
	mountRoute(app, deleteAllowedInviteRoute);

	mountRoute(app, listFilterExemptionsRoute);
	mountRoute(app, setFilterExemptionRoute);
	mountRoute(app, deleteFilterExemptionRoute);
	mountRoute(app, listExperimentsRoute);
	mountRoute(app, upsertExperimentRoute);
	mountRoute(app, deleteExperimentRoute);
	mountRoute(app, getWsTicketRoute);

	app.listen(getContext().env.API_PORT, () =>
		getContext().logger.info({ port: getContext().env.API_PORT }, 'Listening to requests'),
	);
}
