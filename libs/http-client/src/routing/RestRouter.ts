import { container } from 'tsyringe';
import type { Rest } from '../rest';
import type { IRouter } from './IRouter';

export const kRest = Symbol('rest instance');

export const kRestRouter = Symbol('rest router');

export const buildRestRouter = () => {
  const rest = container.resolve<Rest>(kRest);

  const method: string[] = [''];
  const handler: ProxyHandler<IRouter> = {
    get(_, property) {
      if (
        property === 'get' ||
        property === 'delete' ||
        property === 'patch' ||
        property === 'put' ||
        property === 'post'
      ) {
        return (data: any) => rest.make(method.join('/'), property, data);
      }

      if (typeof property === 'string') {
        method.push(property);
      }

      return new Proxy<IRouter>({} as any, handler);
    }
  };

  const proxy = new Proxy<IRouter>({} as any, handler);

  container.register<IRouter>(kRestRouter, { useValue: proxy });
  return proxy;
};
