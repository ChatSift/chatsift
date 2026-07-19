/**
 * Actual runtime polka app assembly. Imported dynamically from `bin.ts` *after* `initContext()` has run — several
 * route modules (transitively, via `util/discordAPI.js`) read `getContext().env` at module-load time, so they
 * can't be statically imported before the context exists.
 */

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
import getAMARoute from './routes/ama/getAMA.js';
import getAMAsRoute from './routes/ama/getAMAs.js';
import repostPromptRoute from './routes/ama/repostPrompt.js';
import updateAMARoute from './routes/ama/updateAMA.js';
import discordRoute from './routes/auth/discord.js';
import discordCallbackRoute from './routes/auth/discordCallback.js';
import logoutRoute from './routes/auth/logout.js';
import meRoute from './routes/auth/me.js';
import createGrantRoute from './routes/guilds/createGrant.js';
import deleteGrantRoute from './routes/guilds/deleteGrant.js';
import getGuildRoute from './routes/guilds/get.js';
import getGrantsRoute from './routes/guilds/getGrants.js';
import { sendBoom } from './util/sendBoom.js';

export async function startServer(): Promise<void> {
	const app = polka({
		onError(err, req, res) {
			// req.logger is set by attachLogger(), the very first `.use()` middleware -- it's only absent here if
			// something throws before any `.use()` middleware ran at all (e.g. polka's own routing/parsing).
			const logger = req.logger ?? getContext().logger;
			logger.error({ err }, 'request error');

			if (res.writableEnded) {
				return;
			}

			if (res.headersSent) {
				logger.warn('weird edge case we have no clue how to handle');
				res.end();
				return;
			}

			res.setHeader('content-type', 'application/json');
			const boom = isBoom(err) ? err : new Boom(err);

			if (boom.output.statusCode === 500) {
				logger.error(boom, boom.message);
			}

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

	// Each call is instantiated against its own route's middleware tuple — folding these into a loop over an array
	// literal would force TS to unify all of them under one `TMiddlewares` instantiation, which doesn't typecheck
	// (see the `unwrapMiddlewareHandle` doc comment in `core/route.ts` for the same heterogeneous-tuple issue).
	mountRoute(app, createAMARoute);
	mountRoute(app, getAMARoute);
	mountRoute(app, getAMAsRoute);
	mountRoute(app, repostPromptRoute);
	mountRoute(app, updateAMARoute);
	mountRoute(app, discordRoute);
	mountRoute(app, discordCallbackRoute);
	mountRoute(app, logoutRoute);
	mountRoute(app, meRoute);
	mountRoute(app, createGrantRoute);
	mountRoute(app, deleteGrantRoute);
	mountRoute(app, getGuildRoute);
	mountRoute(app, getGrantsRoute);

	app.listen(getContext().env.API_PORT, () =>
		getContext().logger.info({ port: getContext().env.API_PORT }, 'Listening to requests'),
	);
}
