/* eslint-disable @typescript-eslint/unbound-method, no-restricted-globals, n/prefer-global/process */

import { Http2ServerResponse } from 'node:http2';
import { Boom } from '@hapi/boom';
import type { Polka, Request, Response } from 'polka';
import { afterEach, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { defineMiddleware, defineRoute } from '../route.js';
import { mountRoute } from '../server.js';

vi.mock('http2');

const broadcastMock = vi.hoisted(() => vi.fn());

// `core/server.ts` imports `getContext` from `@chatsift/backend-core`, which eagerly parses `process.env`
// against its full schema at module-load time -- this env-var block is required just to let the module
// load, mirroring `middleware/__tests__/isAuthed.test.ts`'s identical mock. `getContext` itself is stubbed
// down to only what `mountRoute`'s `realtimeChannel` broadcast hook reads.
vi.mock('@chatsift/backend-core', async (importActual) => {
	process.env['ROOT_DOMAIN'] = '';
	process.env['OAUTH_DISCORD_CLIENT_ID'] = '123456789012345678';
	process.env['OAUTH_DISCORD_CLIENT_SECRET'] = 'so secret';
	process.env['API_URL_DEV'] = 'http://localhost:9876';
	process.env['API_URL_PROD'] = 'https://api.example.com';
	process.env['FRONTEND_URL_DEV'] = 'http://localhost:3000';
	process.env['FRONTEND_URL_PROD'] = 'https://example.com';
	process.env['CORS'] = 'http:\\/\\/localhost:3000';
	process.env['API_PORT'] = '9876';
	process.env['ENCRYPTION_KEY'] = '7J7xgcVq3ZWu0RENu1riW7wJPYdqZzA1+kBRKMxhG0g=';
	process.env['DATABASE_URL_DEV'] = 'postgres://user:password@localhost:5432/dbname';
	process.env['DATABASE_URL_PROD'] = 'postgres://user:password@localhost:5432/dbname';
	process.env['REDIS_URL_DEV'] = 'redis://localhost:6379';
	process.env['REDIS_URL_PROD'] = 'redis://localhost:6379';
	process.env['AMA_BOT_TOKEN'] = 'abcdef';
	process.env['MODMAIL_BOT_TOKEN'] = 'abcdef';
	process.env['DOZZLE_WEBHOOK_SECRET'] = 'so secret too';
	process.env['DOZZLE_WEBHOOK_DISCORD_ID'] = '123456789012345678';
	process.env['DOZZLE_WEBHOOK_DISCORD_TOKEN'] = 'abcdef';
	process.env['METRICS_SECRET'] = 'so secret three';

	const actual = (await importActual()) as typeof import('@chatsift/backend-core');

	return {
		...actual,
		getContext: () => ({ service: { wsHub: { broadcast: broadcastMock } } }),
	};
});

const MockedResponse = Http2ServerResponse as unknown as new () => Response;
// Every real request carries a `req.logger` by the time it reaches `mountRoute`'s middleware chain (attached by
// `attachLogger()`, mounted ahead of it in `app.ts`), so mocked requests get one here too by default.
const makeMockedRequest = (data: any): Request =>
	({ logger: { info: vi.fn(), warn: vi.fn() }, ...data }) as unknown as Request;

afterEach(() => {
	vi.resetAllMocks();
});

const makeServer = () => {
	const routes = new Map<string, unknown[]>();
	const server = {
		get: vi.fn((path: string, ...handlers: unknown[]) => routes.set(`get:${path}`, handlers)),
		post: vi.fn((path: string, ...handlers: unknown[]) => routes.set(`post:${path}`, handlers)),
	};

	return { server: server as unknown as Polka<any>, routes };
};

test('registers onto the server under the route method + path', () => {
	const { server, routes } = makeServer();
	const route = defineRoute({
		method: 'get',
		path: '/v3/guilds/:guildId',
		async handler() {
			return { ok: true };
		},
	});

	mountRoute(server, route);

	expect(server.get).toHaveBeenCalledTimes(1);
	expect(routes.has('get:/v3/guilds/:guildId')).toBe(true);
});

test('tracking middleware logs the incoming request via req.logger and calls next', async () => {
	const { server, routes } = makeServer();
	mountRoute(
		server,
		defineRoute({
			method: 'get',
			path: '/v3/foo',
			async handler() {
				return null;
			},
		}),
	);

	const tracking = (routes.get('get:/v3/foo')! as ((req: Request, res: Response, next: any) => Promise<void>)[])[0]!;
	const req = makeMockedRequest({ headers: {}, method: 'GET', path: '/v3/foo' });
	const res = new MockedResponse();
	const next = vi.fn();

	await tracking(req, res, next);

	expect(req.logger.info).toHaveBeenCalledWith({ method: 'GET', path: '/v3/foo' }, 'incoming request');
	expect(next).toHaveBeenCalledWith();
});

test('does not add a JSON parser when no body schema is declared', () => {
	const { server, routes } = makeServer();
	mountRoute(
		server,
		defineRoute({
			method: 'get',
			path: '/v3/foo',
			schema: { query: z.object({ q: z.string() }) },
			async handler() {
				return null;
			},
		}),
	);

	// tracking + validation + final handler, no jsonParser
	expect(routes.get('get:/v3/foo')).toHaveLength(3);
});

test('adds a JSON parser when a body schema is declared', () => {
	const { server, routes } = makeServer();
	mountRoute(
		server,
		defineRoute({
			method: 'post',
			path: '/v3/foo',
			schema: { body: z.object({ q: z.string() }) },
			async handler() {
				return null;
			},
		}),
	);

	// tracking + jsonParser + validation + final handler
	expect(routes.get('post:/v3/foo')).toHaveLength(4);
});

test('validation middleware parses body/query/params and calls next on success', async () => {
	const { server, routes } = makeServer();
	mountRoute(
		server,
		defineRoute({
			method: 'post',
			path: '/v3/foo/:id',
			schema: {
				body: z.object({ q: z.string() }),
				query: z.object({ n: z.stringbool().default(false) }),
				params: z.object({ id: z.string() }),
			},
			async handler() {
				return null;
			},
		}),
	);

	const handlers = routes.get('post:/v3/foo/:id')! as ((req: Request, res: Response, next: any) => Promise<void>)[];
	const validate = handlers[2]!;

	const req = makeMockedRequest({ body: { q: 'hi' }, query: {}, params: { id: '123' } });
	const res = new MockedResponse();
	const next = vi.fn();

	await validate(req, res, next);

	expect(next).toHaveBeenCalledWith();
	expect(req.body).toStrictEqual({ q: 'hi' });
	expect(req.query).toStrictEqual({ n: false });
	expect(req.params).toStrictEqual({ id: '123' });
});

test('validation middleware calls next with a 400 Boom on invalid input', async () => {
	const { server, routes } = makeServer();
	mountRoute(
		server,
		defineRoute({
			method: 'post',
			path: '/v3/foo',
			schema: { body: z.object({ q: z.string() }) },
			async handler() {
				return null;
			},
		}),
	);

	const handlers = routes.get('post:/v3/foo')! as ((req: Request, res: Response, next: any) => Promise<void>)[];
	const validate = handlers[2]!;

	const req = makeMockedRequest({ body: { q: 5 } });
	const res = new MockedResponse();
	const next = vi.fn();

	await validate(req, res, next);

	expect(next).toHaveBeenCalledWith(expect.any(Boom));
	expect((next.mock.calls[0]![0] as Boom).output.statusCode).toBe(400);
});

test('route middleware handles are unwrapped and run in order before the final handler', async () => {
	const { server, routes } = makeServer();
	const calls: string[] = [];
	const first = defineMiddleware(async (_req, _res, next) => {
		calls.push('first');
		return next();
	});
	const second = defineMiddleware<{ extra: string }>(async (req, _res, next) => {
		calls.push('second');
		Reflect.set(req, 'extra', 'value');
		return next();
	});

	mountRoute(
		server,
		defineRoute({
			method: 'get',
			path: '/v3/foo',
			middleware: [first, second] as const,
			async handler(req) {
				calls.push('handler');
				return { extra: req.extra };
			},
		}),
	);

	const handlers = routes.get('get:/v3/foo')! as ((req: Request, res: Response, next: any) => Promise<void>)[];
	// tracking, first, second, final handler
	expect(handlers).toHaveLength(4);

	const req = makeMockedRequest({ headers: {}, method: 'GET', path: '/v3/foo' });
	const res = new MockedResponse();
	const next = vi.fn();

	for (const handler of handlers) {
		await handler(req, res, next);
	}

	expect(calls).toStrictEqual(['first', 'second', 'handler']);
});

test('serializes a non-nullish handler result as 200 JSON', async () => {
	const { server, routes } = makeServer();
	mountRoute(
		server,
		defineRoute({
			method: 'get',
			path: '/v3/foo',
			async handler() {
				return { hello: 'world' };
			},
		}),
	);

	const handlers = routes.get('get:/v3/foo')! as ((req: Request, res: Response, next: any) => Promise<void>)[];
	const final = handlers.at(-1)!;

	const req = makeMockedRequest({ headers: {}, method: 'GET', path: '/v3/foo' });
	const res = new MockedResponse();
	// Hack because vitest is wiping http2 internals and causing any access to statusCode/writableEnded to throw
	Object.defineProperty(res, 'statusCode', { writable: true, enumerable: true, configurable: true });
	Object.defineProperty(res, 'writableEnded', { writable: true, enumerable: true, configurable: true, value: false });
	const next = vi.fn();

	await final(req, res, next);

	expect(res.statusCode).toBe(200);
	expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
	expect(res.end).toHaveBeenCalledWith(JSON.stringify({ hello: 'world' }));
});

test('serializes a null/undefined handler result as 204', async () => {
	const { server, routes } = makeServer();
	mountRoute(
		server,
		defineRoute({
			method: 'get',
			path: '/v3/foo',
			async handler() {
				return undefined;
			},
		}),
	);

	const handlers = routes.get('get:/v3/foo')! as ((req: Request, res: Response, next: any) => Promise<void>)[];
	const final = handlers.at(-1)!;

	const req = makeMockedRequest({ headers: {}, method: 'GET', path: '/v3/foo' });
	const res = new MockedResponse();
	// Hack because vitest is wiping http2 internals and causing any access to statusCode/writableEnded to throw
	Object.defineProperty(res, 'statusCode', { writable: true, enumerable: true, configurable: true });
	Object.defineProperty(res, 'writableEnded', { writable: true, enumerable: true, configurable: true, value: false });
	const next = vi.fn();

	await final(req, res, next);

	expect(res.statusCode).toBe(204);
	expect(res.end).toHaveBeenCalledWith();
});

test('forwards handler errors to next instead of throwing', async () => {
	const { server, routes } = makeServer();
	const error = new Error('boom');
	mountRoute(
		server,
		defineRoute({
			method: 'get',
			path: '/v3/foo',
			async handler() {
				throw error;
			},
		}),
	);

	const handlers = routes.get('get:/v3/foo')! as ((req: Request, res: Response, next: any) => Promise<void>)[];
	const final = handlers.at(-1)!;

	const req = makeMockedRequest({ headers: {}, method: 'GET', path: '/v3/foo' });
	const res = new MockedResponse();
	const next = vi.fn();

	await final(req, res, next);

	expect(next).toHaveBeenCalledWith(error);
});

test('broadcasts to the WS gateway via realtimeChannel when the handler succeeds', async () => {
	const { server, routes } = makeServer();
	mountRoute(
		server,
		defineRoute({
			method: 'get',
			path: '/v3/foo',
			realtimeChannel: () => 'some-channel',
			async handler() {
				return { ok: true };
			},
		}),
	);

	const handlers = routes.get('get:/v3/foo')! as ((req: Request, res: Response, next: any) => Promise<void>)[];
	const final = handlers.at(-1)!;

	const req = makeMockedRequest({ headers: {}, method: 'GET', path: '/v3/foo' });
	const res = new MockedResponse();
	Object.defineProperty(res, 'statusCode', { writable: true, enumerable: true, configurable: true });
	Object.defineProperty(res, 'writableEnded', { writable: true, enumerable: true, configurable: true, value: false });
	const next = vi.fn();

	await final(req, res, next);

	expect(broadcastMock).toHaveBeenCalledWith('some-channel', { type: 'invalidate', channel: 'some-channel' });
});

test('does not broadcast when realtimeChannel returns undefined', async () => {
	const { server, routes } = makeServer();
	mountRoute(
		server,
		defineRoute({
			method: 'get',
			path: '/v3/foo',
			realtimeChannel: () => undefined,
			async handler() {
				return { ok: true };
			},
		}),
	);

	const handlers = routes.get('get:/v3/foo')! as ((req: Request, res: Response, next: any) => Promise<void>)[];
	const final = handlers.at(-1)!;

	const req = makeMockedRequest({ headers: {}, method: 'GET', path: '/v3/foo' });
	const res = new MockedResponse();
	Object.defineProperty(res, 'statusCode', { writable: true, enumerable: true, configurable: true });
	Object.defineProperty(res, 'writableEnded', { writable: true, enumerable: true, configurable: true, value: false });
	const next = vi.fn();

	await final(req, res, next);

	expect(broadcastMock).not.toHaveBeenCalled();
});

test('does not broadcast when the handler throws', async () => {
	const { server, routes } = makeServer();
	mountRoute(
		server,
		defineRoute({
			method: 'get',
			path: '/v3/foo',
			realtimeChannel: () => 'some-channel',
			async handler() {
				throw new Error('boom');
			},
		}),
	);

	const handlers = routes.get('get:/v3/foo')! as ((req: Request, res: Response, next: any) => Promise<void>)[];
	const final = handlers.at(-1)!;

	const req = makeMockedRequest({ headers: {}, method: 'GET', path: '/v3/foo' });
	const res = new MockedResponse();
	const next = vi.fn();

	await final(req, res, next);

	expect(broadcastMock).not.toHaveBeenCalled();
});
