import { expect, test, vi } from 'vitest';
import { defineMiddleware, defineRoute } from '../route.js';

test('defineRoute returns the config it was given, unmodified', () => {
	const handler = vi.fn();
	const config = {
		method: 'get' as const,
		path: '/v3/guilds/:guildId' as const,
		handler,
	};

	expect(defineRoute(config)).toBe(config);
});

test('defineMiddleware wraps the given handler under .handle', async () => {
	const handle = vi.fn();
	const middleware = defineMiddleware(handle);

	const req = {} as any;
	const res = {} as any;
	const next = vi.fn();
	await middleware.handle(req, res, next);

	expect(handle).toHaveBeenCalledWith(req, res, next);
});
