/* eslint-disable no-restricted-globals, n/prefer-global/process, @typescript-eslint/unbound-method */

import { Http2ServerResponse } from 'node:http2';
import {
	createDatabase,
	createLogger,
	createRedis,
	encrypt,
	getContext,
	GRANTS,
	initContext,
	NewAccessTokenHeader,
} from '@chatsift/backend-core';
import { DiscordAPIError } from '@discordjs/rest';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'polka';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { resetDiscordOAuthRefreshCoalescing } from '../../util/discordOAuthRefresh.js';
import type { AccessTokenData } from '../../util/tokens.js';
import { attachHttpUtils } from '../attachHttpUtils.js';
import { isAuthed } from '../isAuthed.js';

vi.mock('http2');

const ADMIN_USER_ID = vi.hoisted(() => '104425482757357568');
// Backs `claimGrantToken` (the real implementation runs in these tests, unmocked) -- defaults to "claim
// succeeds" (redis `SET ... NX` returning `'OK'`), overridden per-test where needed to simulate an
// already-claimed (consumed) token by returning `null`, as the real client does when `NX` finds the key set.
const redisExistsMock = vi.hoisted(() => vi.fn(async () => 0));
const redisSetMock = vi.hoisted(() => vi.fn(async (): Promise<string | null> => 'OK'));
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

	// eslint-disable-next-line @typescript-eslint/consistent-type-imports
	const actual = (await importActual()) as typeof import('@chatsift/backend-core');

	return {
		...actual,
		getContext: () => ({ ...actual.getContext(), UP_SINCE: Date.now() - 1_000 * 60 * 5 }),
		// No dashboard grant for any guild
		createDatabase: () => vi.fn(async () => []),
		createRedis: () => ({
			get: vi.fn(async () => null),
			exists: redisExistsMock,
			set: redisSetMock,
		}),
	};
});

beforeAll(async () => {
	const logger = createLogger('api');
	const db = createDatabase();
	const redis = await createRedis(logger);
	initContext({ db, logger, redis });
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

	// Mirrors createAccessToken's real behavior -- discordAccessToken is encrypted (not just signed) at rest.
	return jwt.sign({ ...data, discordAccessToken: encrypt(data.discordAccessToken) }, getContext().env.ENCRYPTION_KEY, {
		expiresIn,
	});
};

interface MockRefreshJWTData {
	/**
	 * How far out the embedded discord access token claims to be valid. The default (5 minutes) sits inside
	 * `refresh`'s ~7 minute buffer, so it takes the rotation path; anything past that buffer instead exercises
	 * the reuse path, where the stored token is handed straight to `/me` without asking discord to reissue it.
	 */
	accessTokenExpiresInMs?: number;
	expiresIn?: number;
	now?: number;
}

const makeRefreshJWT = ({
	now = Date.now(),
	expiresIn = 60 * 60 * 24 * 30,
	accessTokenExpiresInMs = 1_000 * 60 * 5,
}: MockRefreshJWTData = {}) => {
	const data = {
		refresh: true,
		iat: Math.floor(now / 1_000),
		sub: USER_ID,
		discordAccessToken: GOOD_ACCESS_TOKEN,
		discordAccessTokenExpiresAt: new Date(now + accessTokenExpiresInMs).toISOString(),
		discordRefreshToken: GOOD_REFRESH_TOKEN,
	};

	// Mirrors createRefreshToken's real behavior -- these fields are encrypted (not just signed) at rest.
	return jwt.sign(
		{
			...data,
			discordAccessToken: encrypt(data.discordAccessToken),
			discordRefreshToken: encrypt(data.discordRefreshToken),
		},
		getContext().env.ENCRYPTION_KEY,
		{ expiresIn },
	);
};

const GRANT_GUILD_ID = '123';

interface MockGrantJWTData {
	expiresIn?: number;
	grant?: string;
	guildId?: string;
	jti?: string;
	kind?: string;
	now?: number;
	sub?: string;
}

const makeGrantJWT = ({
	now = Date.now(),
	expiresIn = 15 * 60,
	kind = 'grant',
	sub = USER_ID,
	guildId = GRANT_GUILD_ID,
	grant = GRANTS.AMA_CREATE,
	jti = 'jti-1',
}: MockGrantJWTData = {}) =>
	jwt.sign({ kind, sub, guildId, grant, jti, iat: Math.floor(now / 1_000) }, getContext().env.ENCRYPTION_KEY, {
		expiresIn,
	});

// Every real request carries a `req.logger` by the time `isAuthed`'s middleware runs (attached by
// `attachLogger()` ahead of it in `app.ts`), so mocked requests get one here too by default.
const makeMockedRequest = (data: any) => ({ logger: getContext().logger, ...data }) as unknown as Request;

const makeDiscordError = (status: number, message: string) =>
	new DiscordAPIError({ code: 0, message }, 0, status, 'GET', 'https://discord.com', {});
const unauthorizedDiscordError = () => makeDiscordError(401, '401: Unauthorized');
// Comfortably past `refresh`'s ~7 minute buffer, so it reuses the stored access token instead of rotating it.
const stillValidCookie = () => `refresh_token=${makeRefreshJWT({ accessTokenExpiresInMs: 1_000 * 60 * 60 })}`;
const MockedResponse = Http2ServerResponse as unknown as new () => Response;
const next = vi.fn();

afterEach(() => {
	vi.resetAllMocks();
	// Rotations are coalesced across requests for a grace window that deliberately outlives the request that
	// performed them -- without this, a test reusing `GOOD_REFRESH_TOKEN` silently inherits the previous test's
	// result and never reaches `refreshTokenMock` at all.
	resetDiscordOAuthRefreshCoalescing();
});

describe('no fallthrough', () => {
	const [{ handle: middleware }] = isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: false });

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
			// Refresh cookie first, access token second: discord invalidates the old refresh token the instant the
			// rotation succeeds, so the new one is committed to the response before anything that can still throw
			// (the `/me` call backing the access token's grants) runs. See `refresh` in `isAuthed.ts`.
			expect(res.setHeader).toHaveBeenNthCalledWith(1, 'Set-Cookie', expect.stringContaining('refresh_token='));
			expect(res.setHeader).toHaveBeenNthCalledWith(2, NewAccessTokenHeader, expect.any(String));
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

	// `discordAccessTokenExpiresAt` is our own bookkeeping, never reconfirmed with discord, so the token it
	// vouches for can be dead long before it says so. Nothing on the reuse path writes a cookie, so a 401 left
	// to propagate here used to 500 the request *and* leave the same dead token in the cookie for the next one
	// -- every subsequent request failing identically until real time caught up with `expiresAt`, up to a week.
	describe('stored discord access token is dead before its recorded expiry', () => {
		test('recovers by rotating instead of failing the request', async () => {
			const res = new MockedResponse();
			await attachHttpUtils()({} as unknown as Request, res, vi.fn());

			// Dead on the reuse path, fine once the rotation below hands over a fresh token.
			getCurrentUserMock.mockRejectedValueOnce(unauthorizedDiscordError()).mockResolvedValue({ id: USER_ID });
			getGuildsMock.mockResolvedValue([]);
			refreshTokenMock.mockResolvedValue({
				access_token: GOOD_ACCESS_TOKEN,
				expires_in: 5 * 60,
				refresh_token: GOOD_REFRESH_TOKEN,
			});

			await middleware(makeMockedRequest({ headers: { cookie: stillValidCookie() } }), res, next);

			expect(refreshTokenMock).toHaveBeenCalledTimes(1);
			expect(next).toHaveBeenCalledWith();
			// A recovered session, not a re-login: both tokens are reissued rather than nooped.
			expect(res.setHeader).toHaveBeenNthCalledWith(1, 'Set-Cookie', expect.stringContaining('refresh_token='));
			expect(res.setHeader).not.toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('refresh_token=noop'));
			expect(res.setHeader).toHaveBeenNthCalledWith(2, NewAccessTokenHeader, expect.any(String));
		});

		test('only forces a re-login once the refresh token is rejected too', async () => {
			const res = new MockedResponse();
			await attachHttpUtils()({} as unknown as Request, res, vi.fn());

			getCurrentUserMock.mockRejectedValue(unauthorizedDiscordError());
			refreshTokenMock.mockRejectedValue(new Error('invalid_grant'));

			await middleware(makeMockedRequest({ headers: { cookie: stillValidCookie() } }), res, next);

			expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'invalidated refresh token'));
			expect(res.setHeader).toHaveBeenNthCalledWith(1, NewAccessTokenHeader, 'noop');
			expect(res.setHeader).toHaveBeenNthCalledWith(2, 'Set-Cookie', expect.stringContaining('refresh_token=noop'));
		});

		test('does not spend a rotation on a non-401 discord failure', async () => {
			const res = new MockedResponse();
			await attachHttpUtils()({} as unknown as Request, res, vi.fn());

			// A discord outage says nothing about whether the token is still good.
			getCurrentUserMock.mockRejectedValue(makeDiscordError(500, '500: Internal Server Error'));

			await expect(
				middleware(makeMockedRequest({ headers: { cookie: stillValidCookie() } }), res, next),
			).rejects.toThrow('500: Internal Server Error');

			expect(refreshTokenMock).not.toHaveBeenCalled();
			// Critically, the session is left completely intact for the next request to retry with.
			expect(res.setHeader).not.toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('refresh_token=noop'));
		});
	});

	// Discord rotates refresh tokens, so the loser of a concurrent redemption gets `invalid_grant` back -- which
	// is indistinguishable from a genuinely dead token and gets the user logged out. The browser fires several
	// dashboard requests in parallel off one session, so this is an ordinary page load, not a rare interleaving.
	test('coalesces concurrent rotations of the same refresh token onto one discord call', async () => {
		const responses = [1, 2, 3].map(() => new MockedResponse());
		await Promise.all(responses.map(async (res) => attachHttpUtils()({} as unknown as Request, res, vi.fn())));

		refreshTokenMock.mockResolvedValue({
			access_token: GOOD_ACCESS_TOKEN,
			expires_in: 5 * 60,
			refresh_token: GOOD_REFRESH_TOKEN,
		});
		getCurrentUserMock.mockResolvedValue({ id: USER_ID });
		getGuildsMock.mockResolvedValue([]);

		const cookie = `refresh_token=${makeRefreshJWT()}`;
		await Promise.all(
			responses.map(async (res) => middleware(makeMockedRequest({ headers: { cookie } }), res, vi.fn())),
		);

		expect(refreshTokenMock).toHaveBeenCalledTimes(1);
		for (const res of responses) {
			expect(res.setHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('refresh_token='));
			expect(res.setHeader).not.toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('refresh_token=noop'));
		}
	});
});

describe('falls through', () => {
	const [{ handle: middleware }] = isAuthed({ fallthrough: true, isGlobalAdmin: false });

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
		const [{ handle: isAuth }, { handle: isAdmin }] = isAuthed({ fallthrough: false, isGlobalAdmin: true });
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
		const result = isAuthed({
			fallthrough: false,
			isGlobalAdmin: false,
			isGuildManager: false,
		});
		const [{ handle: isAuth }] = result;
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
		expect(result).toHaveLength(1);
	});
});

describe('guild level checks', () => {
	const [{ handle: isAuth }, { handle: isGuildManager }] = isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	});
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

describe('grant token auth', () => {
	test('accepts a valid grant token, skips all cookie/session logic, and never touches the response', async () => {
		const [{ handle: isAuth }] = isAuthed({
			fallthrough: false,
			isGlobalAdmin: false,
			isGuildManager: false,
			grants: [GRANTS.AMA_CREATE],
		});
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		const req = makeMockedRequest({ headers: { authorization: makeGrantJWT() }, params: {} });
		await isAuth(req, res, next);

		expect(next).toHaveBeenCalledWith();
		expect(req.grant).toMatchObject({
			kind: 'grant',
			sub: USER_ID,
			guildId: GRANT_GUILD_ID,
			grant: GRANTS.AMA_CREATE,
		});
		expect(req.tokens).toBeUndefined();
		// The whole point of the isolation guarantee: a grant request must never set/clear the session cookie or
		// the access-token-refresh header, even implicitly.
		expect(res.setHeader).not.toHaveBeenCalled();
	});

	test('rejects a grant string not permitted for this route', async () => {
		const [{ handle: isAuth }] = isAuthed({
			fallthrough: false,
			isGlobalAdmin: false,
			isGuildManager: false,
			grants: ['some:other-grant' as (typeof GRANTS)[keyof typeof GRANTS]],
		});
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		await isAuth(makeMockedRequest({ headers: { authorization: makeGrantJWT() }, params: {} }), res, next);

		expect(next).toHaveBeenCalledWith(makeExpectedBoom(403, 'grant not permitted'));
	});

	test('rejects a guildId mismatch on a route with a :guildId param', async () => {
		const [{ handle: isAuth }] = isAuthed({
			fallthrough: false,
			isGlobalAdmin: false,
			isGuildManager: true,
			grants: [GRANTS.AMA_CREATE],
		});
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		await isAuth(
			makeMockedRequest({
				headers: { authorization: makeGrantJWT({ guildId: GRANT_GUILD_ID }) },
				params: { guildId: 'a-different-guild' },
			}),
			res,
			next,
		);

		expect(next).toHaveBeenCalledWith(makeExpectedBoom(403, 'grant guild mismatch'));
	});

	test('does not enforce a guildId match on routes without a :guildId param (e.g. /v3/auth/me)', async () => {
		const [{ handle: isAuth }] = isAuthed({
			fallthrough: false,
			isGlobalAdmin: false,
			isGuildManager: false,
			grants: [GRANTS.AMA_CREATE],
		});
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		const req = makeMockedRequest({ headers: { authorization: makeGrantJWT() }, params: {} });
		await isAuth(req, res, next);

		expect(next).toHaveBeenCalledWith();
		expect(req.grant?.guildId).toBe(GRANT_GUILD_ID);
	});

	test('rejects an already-consumed grant token on a route that claims it', async () => {
		redisSetMock.mockResolvedValueOnce(null);

		const [{ handle: isAuth }] = isAuthed({
			claimsGrant: true,
			fallthrough: false,
			isGlobalAdmin: false,
			isGuildManager: false,
			grants: [GRANTS.AMA_CREATE],
		});
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		await isAuth(makeMockedRequest({ headers: { authorization: makeGrantJWT() }, params: {} }), res, next);

		expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'grant token already used'));
	});

	test('only lets one of two concurrent requests with the same grant token through a route that claims it', async () => {
		// Stands in for the real client's `SET ... NX` semantics: the first caller to reach this claims the key,
		// any other caller for the same `jti` finds it already set. This is what makes it safe for `createAMA.ts`
		// to rely on the claim happening here rather than a separate "is it used yet" check.
		let claimed = false;
		redisSetMock.mockImplementation(async () => {
			if (claimed) {
				return null;
			}

			claimed = true;
			return 'OK';
		});

		const [{ handle: isAuth }] = isAuthed({
			claimsGrant: true,
			fallthrough: false,
			isGlobalAdmin: false,
			isGuildManager: false,
			grants: [GRANTS.AMA_CREATE],
		});
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		const token = makeGrantJWT();
		const nextA = vi.fn();
		const nextB = vi.fn();

		await Promise.all([
			isAuth(makeMockedRequest({ headers: { authorization: token }, params: {} }), res, nextA),
			isAuth(makeMockedRequest({ headers: { authorization: token }, params: {} }), res, nextB),
		]);

		const outcomes = [nextA, nextB].map((fn) => fn.mock.calls[0]?.[0]);

		expect(outcomes.filter((error) => error === undefined)).toHaveLength(1);
		expect(outcomes.filter((error) => error !== undefined)).toEqual([
			makeExpectedBoom(401, 'grant token already used'),
		]);
	});

	test('a route without `claimsGrant` never claims the token, so the same link can be read from repeatedly before it is used', async () => {
		// This is the regression the bug report was about: `getAMAs`/`/v3/auth/me`/`getGuild` all accept the same
		// grant token as `createAMA` (to drive the create page's chrome while it loads), but must NOT claim it --
		// otherwise the page load itself burns the single-use link before the user ever submits the form.
		const [{ handle: isAuth }] = isAuthed({
			fallthrough: false,
			isGlobalAdmin: false,
			isGuildManager: false,
			grants: [GRANTS.AMA_CREATE],
		});
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		const token = makeGrantJWT();
		const nextA = vi.fn();
		const nextB = vi.fn();

		await isAuth(makeMockedRequest({ headers: { authorization: token }, params: {} }), res, nextA);
		await isAuth(makeMockedRequest({ headers: { authorization: token }, params: {} }), res, nextB);

		expect(nextA).toHaveBeenCalledWith();
		expect(nextB).toHaveBeenCalledWith();
		expect(redisSetMock).not.toHaveBeenCalled();
	});

	test('falls through to normal session auth when the header holds a real access token, not a grant', async () => {
		const [{ handle: isAuth }] = isAuthed({
			fallthrough: false,
			isGlobalAdmin: false,
			isGuildManager: false,
			grants: [GRANTS.AMA_CREATE],
		});
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		const req = makeMockedRequest({
			headers: { authorization: makeAccessJWT(), cookie: `refresh_token=${makeRefreshJWT()}` },
			params: {},
		});
		await isAuth(req, res, next);

		expect(next).toHaveBeenCalledWith();
		expect(req.grant).toBeUndefined();
		expect(req.tokens?.access.sub).toBe(USER_ID);
	});

	test('a grant-shaped token is rejected as a malformed access token on a route without `grants`, never treated as a session', async () => {
		const [{ handle: isAuth }] = isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: false });
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		await isAuth(
			makeMockedRequest({
				headers: { authorization: makeGrantJWT(), cookie: `refresh_token=${makeRefreshJWT()}` },
				params: {},
			}),
			res,
			next,
		);

		expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'malformed access token'));
	});

	test('guild-manager step short-circuits for a request already authed via grant', async () => {
		const [{ handle: isAuth }, { handle: isGuildManager }] = isAuthed({
			fallthrough: false,
			isGlobalAdmin: false,
			isGuildManager: true,
			grants: [GRANTS.AMA_CREATE],
		});
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		const req = makeMockedRequest({
			headers: { authorization: makeGrantJWT({ guildId: GRANT_GUILD_ID }) },
			params: { guildId: GRANT_GUILD_ID },
		});

		await isAuth(req, res, next);
		expect(next).toHaveBeenCalledWith();
		vi.clearAllMocks();

		await isGuildManager(req, res, next);

		expect(next).toHaveBeenCalledWith();
		// No `req.guild` reconstruction (no `fetchMe`/Discord call) needed for a grant-authed request.
		expect(getCurrentUserMock).not.toHaveBeenCalled();
		expect(getGuildsMock).not.toHaveBeenCalled();
	});
});
