import { join as joinPath } from 'path';
import { Route, RouteMethod } from '../route';
import { container } from 'tsyringe';
import { kLogger } from '@automoderator/injection';

container.register(kLogger, { useValue: { trace: jest.fn() } });

describe('path to route info', () => {
  test('faulty parameters', () => {
    expect(Route.pathToRouteInfo('foo')).toBe(null);
    expect(Route.pathToRouteInfo('post.rs')).toBe(null);
  });

  test('POST root', () => {
    const route = Route.pathToRouteInfo(joinPath('post.js'));
    expect(route).not.toBe(null);
    expect(route!.path).toBe('/');
    expect(route!.method).toBe('post');
  });

  test('GET subfolder', () => {
    const route = Route.pathToRouteInfo(joinPath('foo', 'bar', 'get.js'));
    expect(route).not.toBe(null);
    expect(route!.path).toBe('/foo/bar');
    expect(route!.method).toBe('get');
  });

  test('PATCH subfolder with params', () => {
    const route = Route.pathToRouteInfo(joinPath('ab', '[c]', 'patch.js'));
    expect(route).not.toBe(null);
    expect(route!.path).toBe('/ab/:c');
    expect(route!.method).toBe('patch');
  });

  test('PUT subfolder with params', () => {
    const route = Route.pathToRouteInfo(joinPath('[abc]', 'def', 'ghi', 'put.js'));
    expect(route).not.toBe(null);
    expect(route!.path).toBe('/:abc/def/ghi');
    expect(route!.method).toBe('put');
  });

  test('DELETE subfolder with params', () => {
    const route = Route.pathToRouteInfo(joinPath('wx', 'y', '[z]', 'delete.js'));
    expect(route).not.toBe(null);
    expect(route!.path).toBe('/wx/y/:z');
    expect(route!.method).toBe('delete');
  });

  test('multiple params', () => {
    const route = Route.pathToRouteInfo(joinPath('a', 'b', '[c]', 'd', '[e]', 'get.js'));
    expect(route).not.toBe(null);
    expect(route!.path).toBe('/a/b/:c/d/:e');
    expect(route!.method).toBe('get');
  });
});

test('register', () => {
  class TestRoute extends Route {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    public handle() {}
  }

  const mockedServer = {
    get: jest.fn()
  };

  const route = new TestRoute();
  route.register(
    {
      method: RouteMethod.get,
      path: '/api/test'
    },
    mockedServer as any
  );

  expect(mockedServer.get).toHaveBeenCalledWith('/api/test', expect.any(Function));
});
