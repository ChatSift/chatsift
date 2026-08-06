/**
 * Actual runtime polka app assembly. Imported dynamically from `bin.ts` *after* `initContext()` has run — several
 * route modules (transitively, via `util/discordAPI.js`) read `getContext().env` at module-load time, so they
 * can't be statically imported before the context exists.
 */

import { createServer } from 'node:http';
import { getContext, NewAccessTokenHeader, setServiceValue } from '@chatsift/backend-core';
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
import sendAMAQuestionRoute from './routes/ama/questions/sendQuestion.js';
import updateAMAQuestionRoute from './routes/ama/questions/updateQuestion.js';
import repostPromptRoute from './routes/ama/repostPrompt.js';
import createAMATagRoute from './routes/ama/tags/createTag.js';
import listAMATagsRoute from './routes/ama/tags/listTags.js';
import updateAMARoute from './routes/ama/updateAMA.js';
import discordRoute from './routes/auth/discord.js';
import discordCallbackRoute from './routes/auth/discordCallback.js';
import logoutRoute from './routes/auth/logout.js';
import meRoute from './routes/auth/me.js';
import dozzleWebhookRoute from './routes/dozzle/webhook.js';
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
import updatePanelRoute from './routes/modmail/panels/updatePanel.js';
import resyncRoute from './routes/modmail/resync.js';
import createSnippetRoute from './routes/modmail/snippets/createSnippet.js';
import deleteSnippetRoute from './routes/modmail/snippets/deleteSnippet.js';
import listSnippetsRoute from './routes/modmail/snippets/listSnippets.js';
import updateSnippetRoute from './routes/modmail/snippets/updateSnippet.js';
import getThreadMessageEditsRoute from './routes/modmail/threads/getMessageEdits.js';
import getThreadRoute from './routes/modmail/threads/getThread.js';
import listThreadsRoute from './routes/modmail/threads/listThreads.js';
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

	setServiceValue('wsHub', attachWebSocketServer(httpServer));

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
	mountRoute(app, listAMATagsRoute);
	mountRoute(app, createAMATagRoute);
	mountRoute(app, discordRoute);
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
	mountRoute(app, listSnippetsRoute);
	mountRoute(app, createSnippetRoute);
	mountRoute(app, updateSnippetRoute);
	mountRoute(app, deleteSnippetRoute);
	mountRoute(app, listBlocksRoute);
	mountRoute(app, createBlockRoute);
	mountRoute(app, deleteBlockRoute);
	mountRoute(app, listThreadsRoute);
	mountRoute(app, getThreadRoute);
	mountRoute(app, getThreadMessageEditsRoute);
	mountRoute(app, resyncRoute);
	mountRoute(app, getWsTicketRoute);

	app.listen(getContext().env.API_PORT, () =>
		getContext().logger.info({ port: getContext().env.API_PORT }, 'Listening to requests'),
	);
}
