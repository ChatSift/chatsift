/* istanbul ignore file */

import { container } from 'tsyringe';
import { kLogger } from '@automoderator/injection';
import type { Logger } from 'pino';
import type { Request, Response, NextHandler } from 'polka';

export const logRequests = () => {
  const logger = container.resolve<Logger>(kLogger);
  return (req: Request, res: Response, next: NextHandler) => {
    const start = Date.now();

    req.once('close', () => logger.info({
      topic: 'REQUEST COMPLETION',
      time: Date.now() - start,
      route: `${req.method.toUpperCase()} ${req.originalUrl}`,
      status: res.statusCode,
      statusText: res.statusMessage,
      body: req.body,
      params: req.params,
      query: req.query
    }));

    return next();
  };
};
