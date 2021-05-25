/* istanbul ignore file */

import { Boom, isBoom, notFound } from '@hapi/boom';
import { sendBoom } from './sendBoom';
import { createServer } from 'http';
import { container } from 'tsyringe';
import { kLogger } from '@automoderator/injection';
import type * as polka from 'polka';
import type { Logger } from 'pino';

export const getPolkaOptions = (): polka.IOptions => {
  const logger = container.resolve<Logger>(kLogger);
  return {
    onError(e: string | polka.IError, _: polka.Request, res: polka.Response) {
      res.setHeader('content-type', 'application/json');
      const boom = isBoom(e) ? e : new Boom(e);

      logger.error({ topic: 'REQUEST INTERNAL ERRROR' }, boom.message);
      return sendBoom(boom, res);
    },
    onNoMatch(_: polka.Request, res: polka.Response) {
      res.setHeader('content-type', 'application/json');
      return sendBoom(notFound(), res);
    },
    server: createServer()
  };
};
