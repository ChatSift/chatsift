/* istanbul ignore file */

import { kLogger } from '@automoderator/injection';
import { Boom, isBoom, notFound } from '@hapi/boom';
import { createServer } from 'http';
import type { Logger } from 'pino';
import type * as polka from 'polka';
import { container } from 'tsyringe';
import { sendBoom } from './sendBoom';

export const getPolkaOptions = (): polka.IOptions => {
	const logger = container.resolve<Logger>(kLogger);
	return {
		onError(e: string | polka.IError, _: polka.Request, res: polka.Response) {
			res.setHeader('content-type', 'application/json');
			const boom = isBoom(e) ? e : new Boom(e);

			if (boom.output.statusCode === 500) {
				logger.error({ error: boom }, boom.message);
			}

			return sendBoom(boom, res);
		},
		onNoMatch(_: polka.Request, res: polka.Response) {
			res.setHeader('content-type', 'application/json');
			return sendBoom(notFound(), res);
		},
		server: createServer(),
	};
};
