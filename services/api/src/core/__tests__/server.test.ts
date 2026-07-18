/* eslint-disable @typescript-eslint/unbound-method */

import { Http2ServerResponse } from 'node:http2';
import { Boom } from '@hapi/boom';
import type { Polka, Request, Response } from 'polka';
import { afterEach, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { defineMiddleware, defineRoute } from '../route.js';
import { mountRoute } from '../server.js';

vi.mock('http2');

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
