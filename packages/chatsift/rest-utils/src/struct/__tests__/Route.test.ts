/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/consistent-type-assertions */

import { ServerResponse } from 'http';
import { Middleware, NextHandler, Polka, Request } from 'polka';
import { Route, RouteMethod } from '../Route';

const serverMock = {
	get: jest.fn(),
	post: jest.fn(),
	put: jest.fn(),
	delete: jest.fn(),
	patch: jest.fn(),
};

afterEach(() => jest.clearAllMocks());

const server = serverMock as unknown as Polka;

describe('pathToRouteInfo', () => {
	test('top level', () => {
		expect(Route.pathToRouteInfo('get.js')).toEqual({ path: '/', method: RouteMethod.get });
	});

	test('sub-route', () => {
		expect(Route.pathToRouteInfo('/sub/post.js')).toEqual({ path: '/sub', method: RouteMethod.post });
	});

	test('invalid method', () => {
		expect(Route.pathToRouteInfo('invalid.js')).toBeNull();
	});
});

class NoMiddlewareTestRoute extends Route {
	public handle = jest.fn();
}

test('registering a route', () => {
	const route = new NoMiddlewareTestRoute();
	route.register({ path: '/', method: RouteMethod.get }, server);

	expect(serverMock.get).toHaveBeenCalled();
	expect(serverMock.get).toHaveBeenCalledWith('/', expect.any(Function));
});

describe('route handler', () => {
	test('without middleware', async () => {
		const route = new NoMiddlewareTestRoute();
		route.register({ path: '/', method: RouteMethod.get }, server);

		const handle: Middleware = serverMock.get.mock.calls[0][1];
		const handleParams = [{} as Request, {} as ServerResponse, jest.fn()] as const;

		expect(await handle(...handleParams)).toBe(undefined);

		expect(route.handle).toHaveBeenCalled();
		expect(route.handle).toHaveBeenCalledWith(...handleParams);
	});

	test('with middleware and error', async () => {
		const middleware = (_: Request, __: ServerResponse, next: NextHandler) => next();

		class TestRoute extends Route {
			public middleware: Middleware[] = [middleware];

			public handle = jest.fn(() => {
				throw new Error('test');
			});
		}

		const route = new TestRoute();
		route.register({ path: 'owo', method: RouteMethod.get }, server);

		expect(serverMock.get).toHaveBeenCalled();
		expect(serverMock.get).toHaveBeenCalledWith('/owo', middleware, expect.any(Function));

		const handle: Middleware = serverMock.get.mock.calls[0][2];
		const next = jest.fn();
		const handleParams = [{} as Request, {} as ServerResponse, next] as const;

		expect(await handle(...handleParams)).toBe(undefined);
		expect(route.handle).toHaveBeenCalled();
		expect(route.handle).toHaveBeenCalledWith(...handleParams);
		expect(next).toHaveBeenCalled();
		expect(next).toHaveBeenCalledWith(new Error('test'));
	});
});
