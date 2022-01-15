/* istanbul ignore file */

import { kLogger } from '@automoderator/injection';
import { Stopwatch } from '@sapphire/stopwatch';
import type { Logger } from 'pino';
import type { NextHandler, Request, Response } from 'polka';
import { container } from 'tsyringe';

export const logRequests = () => {
	const logger = container.resolve<Logger>(kLogger);
	return (req: Request, res: Response, next: NextHandler) => {
		const stopwatch = new Stopwatch();

		req.once('close', () =>
			logger.metric!({
				type: 'api_request',
				duration: stopwatch.stop().duration,
				method: req.method,
				route: req.originalUrl,
				status: res.statusCode,
				statusText: res.statusMessage,
				body: req.body,
				params: req.params,
				query: req.query,
			}),
		);

		return next();
	};
};
