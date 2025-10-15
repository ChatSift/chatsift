/* eslint-disable no-restricted-globals, n/prefer-global/process, @typescript-eslint/unbound-method */

import { Http2ServerResponse } from 'node:http2';
import { NewAccessTokenHeader } from '@chatsift/backend-core';
import jwt from 'jsonwebtoken';
import type { Middleware, Request, Response } from 'polka';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { context } from '../../context.js';
import { clearCache as clearMeCache } from '../../util/me.js';
import type { AccessTokenData } from '../../util/tokens.js';
import { attachHttpUtils } from '../attachHttpUtils.js';
import { isAuthed } from '../isAuthed.js';

vi.mock('http2');

const ADMIN_USER_ID = vi.hoisted(() => '104425482757357568');
vi.mock('@chatsift/backend-core', async (importActual) => {
	process.env['ROOT_DOMAIN'] = '';
	process.env['OAUTH_DISCORD_CLIENT_ID'] = '123456789012345678';
	process.env['OAUTH_DISCORD_CLIENT_SECRET'] = 'so secret';
	process.env['API_URL_DEV'] = 'http://localhost:9876';
	process.env['API_URL_PROD'] = 'https://api.example.com';
	process.env['FRONTEND_URL_DEV'] = 'http://localhost:3000';
	process.env['FRONTEND_URL_PROD'] = 'https://example.com';
	process.env['ADMINS'] = ADMIN_USER_ID;
	process.env['CORS'] = 'http:\\/\\/localhost:3000';
	process.env['API_PORT'] = '9876';
	process.env['ENCRYPTION_KEY'] = '7J7xgcVq3ZWu0RENu1riW7wJPYdqZzA1+kBRKMxhG0g=';
	process.env['DATABASE_URL'] = 'postgres://user:password@localhost:5432/dbname';
	process.env['REDIS_URL'] = 'redis://localhost:6379';
	process.env['AMA_BOT_TOKEN'] = 'abcdef';

	// eslint-disable-next-line @typescript-eslint/consistent-type-imports
	const actual = (await importActual()) as typeof import('@chatsift/backend-core');

	return {
		...actual,
		// @ts-expect-error - Arg forwarding
		createContext: (...args: any[]) => ({ ...actual.createContext(...args), UP_SINCE: Date.now() - 1_000 * 60 * 5 }),
		createDatabase: () => ({
			selectFrom: () => ({
				where: () => ({
					where: () => ({
						select: () => ({
							// TODO: Mock and test at some point
							executeTakeFirst: vi.fn(async () => undefined),
						}),
					}),
				}),
			}),
		}),
		createRedis: () => ({
			get: vi.fn(async () => null),
		}),
	};
});

const refreshTokenMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getGuildsMock = vi.hoisted(() => vi.fn());
vi.mock('../../util/discordAPI.js', () => ({
	discordAPIOAuth: {
		oauth2: {
			refreshToken: refreshTokenMock,
		},
		users: {
			getCurrent: getCurrentUserMock,
			getGuilds: getGuildsMock,
		},
	},
}));

const makeExpectedBoom = (statusCode: number, message: string) =>
	expect.objectContaining({
		output: expect.objectContaining({
			payload: expect.objectContaining({
				statusCode,
				message: expect.stringContaining(message),
			}),
		}),
	});

const USER_ID = '223703707118731264';
const GOOD_ACCESS_TOKEN = ':)';
const BAD_ACCESS_TOKEN = ':(';
const GOOD_REFRESH_TOKEN = ':>';
const BAD_REFRESH_TOKEN = ':<';

interface MockAccessJWTData {
	expiresIn?: number;
	grants?: { guildIds: string[] };
	now?: number;
	sub?: string;
}

const makeAccessJWT = ({ now = Date.now(), expiresIn = 5 * 60, grants, sub = USER_ID }: MockAccessJWTData = {}) => {
	const data: AccessTokenData = {
		refresh: false,
		iat: Math.floor(now / 1_000),
		sub,
		discordAccessToken: GOOD_ACCESS_TOKEN,
		grants: { adminGuilds: grants?.guildIds ?? [] },
	};

	return jwt.sign(data, context.env.ENCRYPTION_KEY, { expiresIn });
};

interface MockRefreshJWTData {
	expiresIn?: number;
	now?: number;
}

const makeRefreshJWT = ({ now = Date.now(), expiresIn = 60 * 60 * 24 * 30 }: MockRefreshJWTData = {}) => {
	const data = {
		refresh: true,
		iat: Math.floor(now / 1_000),
		sub: USER_ID,
		discordAccessToken: GOOD_ACCESS_TOKEN,
		discordAccessTokenExpiresAt: new Date(now + 1_000 * 60 * 5).toISOString(),
		discordRefreshToken: GOOD_REFRESH_TOKEN,
	};

	return jwt.sign(data, context.env.ENCRYPTION_KEY, { expiresIn });
};

const makeMockedRequest = (data: any) => data as unknown as Request;
const MockedResponse = Http2ServerResponse as unknown as new () => Response;
const next = vi.fn();

afterEach(() => {
	vi.resetAllMocks();
	clearMeCache();
});

describe('no fallthrough', () => {
	const [middleware] = isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: false }) as [Middleware];

	test('no tokens', async () => {
		const res = new MockedResponse();
		await middleware(makeMockedRequest({ headers: {} }), res, next);

		expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'expired or missing'));
	});

	test('good access token but no refresh', async () => {
		const res = new MockedResponse();
		const req = makeMockedRequest({
			headers: {
				authorization: makeAccessJWT(),
			},
		});
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());
		await middleware(req, res, next);

		expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'missing refresh token'));
		expect(res.setHeader).toHaveBeenCalledTimes(1);
		expect(res.setHeader).toHaveBeenNthCalledWith(1, NewAccessTokenHeader, 'noop');
	});

	test('good access token', async () => {
		const res = new MockedResponse();
		const req = makeMockedRequest({
			headers: {
				authorization: makeAccessJWT(),
				cookie: `refresh_token=${makeRefreshJWT()}`,
			},
		});
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());
		await middleware(req, res, next);

		expect(res.setHeader).toHaveBeenCalledTimes(1);
		expect(res.setHeader).toHaveBeenNthCalledWith(1, 'Set-Cookie', expect.stringContaining('refresh_token='));
		expect(next).toHaveBeenCalledWith();
		expect(req.tokens?.access.sub).toBe(USER_ID);
	});

	test('malformed access token', async () => {
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());
		await middleware(
			makeMockedRequest({
				headers: {
					authorization: 'malformed.token.here',
					cookie: `refresh_token=${makeRefreshJWT()}`,
				},
			}),
			res,
			next,
		);

		expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'malformed access token'));
		expect(res.setHeader).toHaveBeenCalledTimes(2);
		expect(res.setHeader).toHaveBeenNthCalledWith(1, NewAccessTokenHeader, 'noop');
		expect(res.setHeader).toHaveBeenNthCalledWith(2, 'Set-Cookie', expect.stringContaining('refresh_token=noop'));
	});

	test('access token set to refresh', async () => {
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());
		await middleware(
			makeMockedRequest({
				headers: {
					authorization: makeRefreshJWT(),
					cookie: `refresh_token=${makeRefreshJWT()}`,
				},
			}),
			res,
			next,
		);

		expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'malformed access token'));
		expect(res.setHeader).toHaveBeenCalledTimes(2);
		expect(res.setHeader).toHaveBeenNthCalledWith(1, NewAccessTokenHeader, 'noop');
		expect(res.setHeader).toHaveBeenNthCalledWith(2, 'Set-Cookie', expect.stringContaining('refresh_token=noop'));
	});

	describe('expired access token', () => {
		test('no refresh token', async () => {
			const res = new MockedResponse();
			await attachHttpUtils()({} as unknown as Request, res, vi.fn());
			await middleware(
				makeMockedRequest({
					headers: {
						authorization: makeAccessJWT({ expiresIn: 0 }),
					},
				}),
				res,
				next,
			);

			expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'missing refresh token'));
			expect(res.setHeader).toHaveBeenCalledTimes(1);
			expect(res.setHeader).toHaveBeenNthCalledWith(1, NewAccessTokenHeader, 'noop');
		});

		test('malformed refresh token', async () => {
			const res = new MockedResponse();
			await attachHttpUtils()({} as unknown as Request, res, vi.fn());
			await middleware(
				makeMockedRequest({
					headers: {
						authorization: makeAccessJWT({ expiresIn: 0 }),
						cookie: 'refresh_token=malformed.token.here',
					},
				}),
				res,
				next,
			);

			expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'malformed refresh token'));
			expect(res.setHeader).toHaveBeenCalledTimes(2);
			expect(res.setHeader).toHaveBeenNthCalledWith(1, NewAccessTokenHeader, 'noop');
			expect(res.setHeader).toHaveBeenNthCalledWith(2, 'Set-Cookie', expect.stringContaining('refresh_token=noop'));
		});

		test('refresh token set to access', async () => {
			const res = new MockedResponse();
			await attachHttpUtils()({} as unknown as Request, res, vi.fn());
			await middleware(
				makeMockedRequest({
					headers: {
						authorization: makeAccessJWT({ expiresIn: 0 }),
						cookie: `refresh_token=${makeAccessJWT()}`,
					},
				}),
				res,
				next,
			);

			expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'malformed refresh token'));
			expect(res.setHeader).toHaveBeenCalledTimes(2);
			expect(res.setHeader).toHaveBeenNthCalledWith(1, NewAccessTokenHeader, 'noop');
			expect(res.setHeader).toHaveBeenNthCalledWith(2, 'Set-Cookie', expect.stringContaining('refresh_token=noop'));
		});

		test('expired refresh token', async () => {
			const res = new MockedResponse();
			await attachHttpUtils()({} as unknown as Request, res, vi.fn());
			await middleware(
				makeMockedRequest({
					headers: {
						authorization: makeAccessJWT({ expiresIn: 0 }),
						cookie: `refresh_token=${makeRefreshJWT({ expiresIn: 0 })}`,
					},
				}),
				res,
				next,
			);

			expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'expired refresh token'));
			expect(res.setHeader).toHaveBeenCalledTimes(2);
			expect(res.setHeader).toHaveBeenNthCalledWith(1, NewAccessTokenHeader, 'noop');
			expect(res.setHeader).toHaveBeenNthCalledWith(2, 'Set-Cookie', expect.stringContaining('refresh_token=noop'));
		});

		test('good refresh token', async () => {
			const res = new MockedResponse();
			await attachHttpUtils()({} as unknown as Request, res, vi.fn());

			refreshTokenMock.mockResolvedValue({
				access_token: GOOD_ACCESS_TOKEN,
				expires_in: 5 * 60,
				refresh_token: GOOD_REFRESH_TOKEN,
			});
			getCurrentUserMock.mockResolvedValue({ id: USER_ID });
			getGuildsMock.mockResolvedValue([]);

			await middleware(
				makeMockedRequest({
					headers: {
						authorization: makeAccessJWT({ expiresIn: 0 }),
						cookie: `refresh_token=${makeRefreshJWT()}`,
					},
				}),
				res,
				next,
			);

			expect(next).toHaveBeenCalledWith();
			expect(res.setHeader).toHaveBeenCalledTimes(2);
			expect(res.setHeader).toHaveBeenNthCalledWith(1, NewAccessTokenHeader, expect.any(String));
			expect(res.setHeader).toHaveBeenNthCalledWith(2, 'Set-Cookie', expect.stringContaining('refresh_token='));
		});

		test("good refresh token but user's discord refresh did not work", async () => {
			const res = new MockedResponse();
			await attachHttpUtils()({} as unknown as Request, res, vi.fn());
			refreshTokenMock.mockRejectedValue(new Error('lol, lmao even'));

			await middleware(
				makeMockedRequest({
					headers: {
						// Expired access to trigger a Discord refresh
						authorization: makeAccessJWT({ expiresIn: 0 }),
						cookie: `refresh_token=${makeRefreshJWT()}`,
					},
				}),
				res,
				next,
			);

			expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'invalidated refresh token'));
			expect(res.setHeader).toHaveBeenCalledTimes(2);
			expect(res.setHeader).toHaveBeenNthCalledWith(1, NewAccessTokenHeader, 'noop');
			expect(res.setHeader).toHaveBeenNthCalledWith(2, 'Set-Cookie', expect.stringContaining('refresh_token=noop'));
		});
	});
});

describe('falls through', () => {
	const [middleware] = isAuthed({ fallthrough: true, isGlobalAdmin: false }) as [Middleware];

	test('it falls through on a basic case', async () => {
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());
		await middleware(makeMockedRequest({ headers: {} }), res, next);

		expect(next).toHaveBeenCalledWith(undefined);
	});

	test('successful auth behaves correctly still', async () => {
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());
		await middleware(
			makeMockedRequest({
				headers: {
					authorization: makeAccessJWT(),
					cookie: `refresh_token=${makeRefreshJWT()}`,
				},
			}),
			res,
			next,
		);

		expect(res.setHeader).toHaveBeenCalledTimes(1);
		expect(res.setHeader).toHaveBeenNthCalledWith(1, 'Set-Cookie', expect.stringContaining('refresh_token='));
		expect(next).toHaveBeenCalledWith();
	});
});

describe('is global admin', () => {
	test('it blocks non-admins', async () => {
		const [isAuth, isAdmin] = isAuthed({ fallthrough: false, isGlobalAdmin: true }) as [Middleware, Middleware];
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		const req = makeMockedRequest({
			headers: {
				// The default USER_ID is not an admin
				authorization: makeAccessJWT(),
				cookie: `refresh_token=${makeRefreshJWT()}`,
			},
		});

		await isAuth(req, res, next);

		expect(next).toHaveBeenCalledWith();
		vi.clearAllMocks();

		await isAdmin(req, res, next);
		expect(next).toHaveBeenCalledWith(makeExpectedBoom(403, 'global admin'));
	});

	test("it does not enforce admin, it doesn't block admins", async () => {
		const [isAuth, isAdmin] = isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: false }) as [
			Middleware,
			Middleware?,
		];
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		const req = makeMockedRequest({
			headers: {
				authorization: makeAccessJWT(),
				cookie: `refresh_token=${makeRefreshJWT()}`,
			},
		});

		await isAuth(req, res, next);

		expect(next).toHaveBeenCalledWith();
		expect(isAdmin).toBe(undefined);
	});
});

describe('guild level checks', () => {
	const [isAuth, isGuildManager] = isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}) as [Middleware, Middleware];
	const params = {
		guildId: '123',
	};

	test('admin bypasses despite not having guild perms', async () => {
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		const req = makeMockedRequest({
			headers: {
				authorization: makeAccessJWT({ sub: ADMIN_USER_ID }),
				cookie: `refresh_token=${makeRefreshJWT()}`,
			},
			params,
		});

		await isAuth(req, res, next);

		expect(next).toHaveBeenCalledWith();
		vi.clearAllMocks();

		getCurrentUserMock.mockResolvedValue({ id: ADMIN_USER_ID });
		getGuildsMock.mockResolvedValue([{ id: '123', permissions: '0' }]);

		await isGuildManager(req, res, next);
		expect(next).toHaveBeenCalledWith();
	});

	test('errors if no guildId param', async () => {
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		const req = makeMockedRequest({
			headers: {
				authorization: makeAccessJWT(),
				cookie: `refresh_token=${makeRefreshJWT()}`,
			},
			params: {},
		});

		await isAuth(req, res, next);

		expect(next).toHaveBeenCalledWith();

		vi.clearAllMocks();

		await isGuildManager(req, res, next);
		expect(next).toHaveBeenCalledWith(makeExpectedBoom(500, 'internal'));
	});

	test('token grant based pass', async () => {
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		const req = makeMockedRequest({
			headers: {
				authorization: makeAccessJWT({ grants: { guildIds: [params.guildId] } }),
				cookie: `refresh_token=${makeRefreshJWT()}`,
			},
			params,
		});

		await isAuth(req, res, next);

		expect(next).toHaveBeenCalledWith();
		vi.clearAllMocks();

		getCurrentUserMock.mockResolvedValue({ id: ADMIN_USER_ID });
		getGuildsMock.mockResolvedValue([{ id: '123', permissions: '0' }]);

		await isGuildManager(req, res, next);
		expect(next).toHaveBeenCalledWith();
	});

	test('grant based fail', async () => {
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		const req = makeMockedRequest({
			headers: {
				authorization: makeAccessJWT(),
				cookie: `refresh_token=${makeRefreshJWT()}`,
			},
			params,
		});

		await isAuth(req, res, next);

		expect(next).toHaveBeenCalledWith();
		vi.clearAllMocks();

		getCurrentUserMock.mockResolvedValue({ id: ADMIN_USER_ID });
		getGuildsMock.mockResolvedValue([{ id: '123', permissions: '0' }]);

		await isGuildManager(req, res, next);
		expect(next).toHaveBeenCalledWith(makeExpectedBoom(403, 'you need to be a manager'));
	});
});
