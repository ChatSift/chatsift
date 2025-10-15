import { glob } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getContext, NewAccessTokenHeader } from '@chatsift/backend-core';
import { Boom, isBoom, notFound } from '@hapi/boom';
import cors from 'cors';
import helmet from 'helmet';
import type { Middleware } from 'polka';
import polka from 'polka';
import { attachHttpUtils } from './middleware/attachHttpUtils.js';
import type { Route, TRequest } from './routes/route.js';
import { sendBoom } from './util/sendBoom.js';

export type * from './routes/_types/index.js';

export async function bin(): Promise<void> {
	const app = polka({
		onError(err, req, res) {
			getContext().logger.error({ err, trackingId: (req as TRequest<any>).trackingId }, 'request error');

			if (res.writableEnded) {
				return;
			}

			if (res.headersSent) {
				getContext().logger.warn('weird edge case we have no clue how to handle');
				res.end();
				return;
			}

			res.setHeader('content-type', 'application/json');
			const boom = isBoom(err) ? err : new Boom(err);

			if (boom.output.statusCode === 500) {
				getContext().logger.error(boom, boom.message);
			}

			sendBoom(boom, res);
		},
		onNoMatch(_, res) {
			res.setHeader('content-type', 'application/json');
			sendBoom(notFound(), res);
		},
	}).use(
		cors({
			origin: getContext().env.CORS,
			credentials: true,
			exposedHeaders: [NewAccessTokenHeader],
		}),
		helmet(getContext().env.IS_PRODUCTION ? {} : { contentSecurityPolicy: false }) as Middleware,
		attachHttpUtils(),
	);

	const path = join(dirname(fileURLToPath(import.meta.url)), 'routes');
	const files = glob(`${path}/**/*.js`);

	getContext().logger.info({ path }, 'Found route files');

	for await (const file of files) {
		const mod = (await import(file)) as { default?: new () => Route<any, any> };
		if (mod.default) {
			const route = new mod.default();
			getContext().logger.info(route.info, 'Registering route');
			route.register(app);
		} else {
			getContext().logger.warn({ file }, 'No default export found on route file');
		}
	}

	app.listen(getContext().env.API_PORT, () =>
		getContext().logger.info({ port: getContext().env.API_PORT }, 'Listening to requests'),
	);
}
