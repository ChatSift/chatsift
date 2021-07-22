import { basename, dirname } from 'path';
import { container } from 'tsyringe';
import { kLogger } from '@automoderator/injection';
import type { Logger } from 'pino';
import type { Request, Middleware, Response, NextHandler, Polka, IError } from 'polka';

export const enum RouteMethod {
  get = 'get',
  post = 'post',
  put = 'put',
  delete = 'delete',
  patch = 'patch',
}

export interface RouteInfo {
  path: string;
  method: RouteMethod;
}

export abstract class Route {
  public static pathToRouteInfo(path: string): RouteInfo | null {
    const method = basename(path, '.js') as RouteMethod;
    if (![RouteMethod.get, RouteMethod.post, RouteMethod.put, RouteMethod.delete, RouteMethod.patch].includes(method)) {
      return null;
    }

    path = path.replace(/\[([a-zA-Z]+)\]/g, ':$1').replace(/\\/g, '/');
    if (!path.startsWith('/')) path = `/${path}`;

    return {
      path: dirname(path),
      method
    };
  }

  public readonly middleware: Middleware[] = [];

  public abstract handle(req: Request, res: Response, next?: NextHandler): any;

  public register(info: RouteInfo, server: Polka) {
    const logger = container.resolve<Logger>(kLogger);

    logger.trace({ topic: 'ROUTE REGISTER' }, `Registering route "${info.method.toUpperCase()} ${info.path}"`);
    server[info.method](`${info.path.startsWith('/') ? '' : '/'}${info.path}`, ...this.middleware, async (req, res, next) => {
      try {
        await this.handle(req, res, next);
      } catch (e) {
        void next(e as IError);
      }
    });
  }
}
