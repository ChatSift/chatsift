/* eslint-disable no-restricted-globals, n/prefer-global/process, @typescript-eslint/unbound-method */

import { Http2ServerResponse } from 'node:http2';
import {
	createDatabase,
	createLogger,
	createRedis,
	encrypt,
	getContext,
	initContext,
	NewAccessTokenHeader,
} from '@chatsift/backend-core';
import { DiscordAPIError } from '@discordjs/rest';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'polka';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { resetDiscordOAuthRefreshCoalescing } from '../../util/discordOAuthRefresh.js';
import type { Me } from '../../util/me.js';
import type { AccessTokenData } from '../../util/tokens.js';
import { attachHttpUtils } from '../attachHttpUtils.js';
import { isAuthed } from '../isAuthed.js';

vi.mock('http2');

const ADMIN_USER_ID = vi.hoisted(() => '104425482757357568');
const redisExistsMock = vi.hoisted(() => vi.fn(async () => 0));
const redisSetMock = vi.hoisted(() => vi.fn(async (): Promise<string | null> => 'OK'));
const isDashboardSessionLiveMock = vi.hoisted(() => vi.fn(async () => true));
const revokeDashboardSessionMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@chatsift/backend-core', async (importActual) => {
	const { stubTestEnv } = await import('../../__tests__/stubEnv.js');
	stubTestEnv();
	// Not part of the shared block: this suite is the only one that needs a global admin to exist.
	process.env['ADMINS'] = ADMIN_USER_ID;

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
		// The redis-backed session registry itself is exercised in `dashboardSession.test.ts` -- mocked here so
		// isAuthed's scoped-session tests can drive it directly without needing a full redis stub.
		isDashboardSessionLive: isDashboardSessionLiveMock,
		revokeDashboardSession: revokeDashboardSessionMock,
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

// `fetchMeForScopedSession` would otherwise hit real Discord REST clients (built from the fake bot tokens
// above) to resolve a scoped session's identity/permissions -- mocked at the module boundary the same way
// `discordAPI.js` is, so isAuthed's tests can drive its result directly.
const fetchMeForScopedSessionMock = vi.hoisted(() => vi.fn());
vi.mock('../../util/me.js', async (importActual) => {
	const actual = (await importActual()) as typeof import('../../util/me.js');

	return {
		...actual,
		fetchMeForScopedSession: fetchMeForScopedSessionMock,
	};
});

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
const GOOD_REFRESH_TOKEN = ':>';

interface MockAccessJWTData {
	expiresIn?: number;
	grants?: { guildIds: string[] };
	now?: number;
	sub?: string;
}

const makeAccessJWT = ({ now = Date.now(), expiresIn = 5 * 60, grants, sub = USER_ID }: MockAccessJWTData = {}) => {
	const data: AccessTokenData = {
		kind: 'oauth',
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
		kind: 'oauth' as const,
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

const SCOPED_GUILD_ID = '555555555555555555';
const SCOPED_SID = 'sid-1';

interface MockScopedAccessJWTData {
	expiresIn?: number;
	guildId?: string;
	kind?: string;
	now?: number;
	sid?: string;
	sub?: string;
}

const makeScopedAccessJWT = ({
	now = Date.now(),
	expiresIn = 5 * 60,
	kind = 'scoped',
	sub = USER_ID,
	guildId = SCOPED_GUILD_ID,
	sid = SCOPED_SID,
}: MockScopedAccessJWTData = {}) =>
	jwt.sign(
		{ kind, refresh: false, iat: Math.floor(now / 1_000), sub, guildId, sid, grants: { adminGuilds: [guildId] } },
		getContext().env.ENCRYPTION_KEY,
		{ expiresIn },
	);

interface MockScopedRefreshJWTData {
	absoluteExpiresAt?: string;
	expiresIn?: number;
	guildId?: string;
	kind?: string;
	now?: number;
	sid?: string;
	sub?: string;
}

const makeScopedRefreshJWT = ({
	now = Date.now(),
	expiresIn = 30 * 60,
	kind = 'scoped',
	sub = USER_ID,
	guildId = SCOPED_GUILD_ID,
	sid = SCOPED_SID,
	absoluteExpiresAt = new Date(now + 30 * 60 * 1_000).toISOString(),
}: MockScopedRefreshJWTData = {}) =>
	jwt.sign(
		{ kind, refresh: true, iat: Math.floor(now / 1_000), sub, guildId, sid, absoluteExpiresAt },
		getContext().env.ENCRYPTION_KEY,
		{ expiresIn },
	);

const makeDashboardLinkJWT = ({
	now = Date.now(),
	expiresIn = 2 * 60,
	sub = USER_ID,
	guildId = SCOPED_GUILD_ID,
	jti = 'link-jti-1',
}: { expiresIn?: number; guildId?: string; jti?: string; now?: number; sub?: string } = {}) =>
	jwt.sign(
		{ kind: 'dashboard-link', sub, guildId, jti, iat: Math.floor(now / 1_000) },
		getContext().env.ENCRYPTION_KEY,
		{
			expiresIn,
		},
	);

const makeScopedMe = (overrides: Partial<Me['guilds'][number]> = {}): Me => ({
	id: USER_ID,
	username: 'someone',
	discriminator: '0',
	global_name: null,
	avatar: null,
	isGlobalAdmin: false,
	guilds: [
		{
			id: SCOPED_GUILD_ID,
			name: 'Some Guild',
			icon: null,
			meCanManage: true,
			bots: ['AMA'],
			amaGuestSessionIds: [],
			customInstanceId: null,
			customInstanceLabel: null,
			customInstanceIconUrl: null,
			...overrides,
		},
	],
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

/**
 * Pulls the JWT out of the most recent `Set-Cookie: refresh_token=...` header `res.setHeader` was called with,
 * for tests that need to inspect what `refresh` actually minted (e.g. that a scoped session's rotated refresh
 * token never carries an `exp` past its `absoluteExpiresAt`).
 */
function decodeSetCookieRefreshToken(res: Response): jwt.JwtPayload {
	const setHeaderMock = res.setHeader as unknown as { mock: { calls: unknown[][] } };
	// `findLast`, not `find` -- a single test can drive multiple rounds of cookie-setting against the same
	// mocked `res` (e.g. a rotation followed by a second request reusing it), and it's always the most recent
	// `Set-Cookie` that reflects the current state, not the first one ever set.
	const call = setHeaderMock.mock.calls.findLast(
		([header, value]) => header === 'Set-Cookie' && typeof value === 'string' && value.includes('refresh_token='),
	);
	if (!call) {
		throw new Error('no Set-Cookie refresh_token header was set');
	}

	const cookieValue = call[1] as string;
	const token = /refresh_token=(?<value>[^;]+)/.exec(cookieValue)!.groups!['value']!;
	return jwt.decode(decodeURIComponent(token)) as jwt.JwtPayload;
}

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

	// A scoped `/dashboard` session is denied outright on a global-admin route, even for a user who also
	// happens to be a global admin -- global-admin routes are never guild-scoped, so there's no sense in which
	// a session minted for one guild should reach them (see `isAuthed.ts`'s `isGlobalAdmin` middleware block).
	test('blocks a scoped session whose sub is a global admin', async () => {
		const [{ handle: isAuth }, { handle: isAdmin }] = isAuthed({ fallthrough: false, isGlobalAdmin: true });
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		const req = makeMockedRequest({
			headers: {
				authorization: makeScopedAccessJWT({ sub: ADMIN_USER_ID }),
				cookie: `refresh_token=${makeScopedRefreshJWT({ sub: ADMIN_USER_ID })}`,
			},
		});

		await isAuth(req, res, next);
		expect(next).toHaveBeenCalledWith();
		vi.clearAllMocks();

		await isAdmin(req, res, next);
		expect(next).toHaveBeenCalledWith(makeExpectedBoom(403, 'not available to a /dashboard session'));
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

	test('adminGuilds claim based pass', async () => {
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

	test('adminGuilds claim based fail', async () => {
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

describe('scoped dashboard session auth', () => {
	test('a valid scoped access token is accepted as a normal session', async () => {
		const [{ handle: isAuth }] = isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: false });
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		const req = makeMockedRequest({
			headers: {
				authorization: makeScopedAccessJWT(),
				cookie: `refresh_token=${makeScopedRefreshJWT()}`,
			},
		});

		await isAuth(req, res, next);

		expect(next).toHaveBeenCalledWith();
		expect(req.tokens?.access).toMatchObject({
			kind: 'scoped',
			sub: USER_ID,
			guildId: SCOPED_GUILD_ID,
			sid: SCOPED_SID,
			grants: { adminGuilds: [SCOPED_GUILD_ID] },
		});
		// Unlike an oauth session, a still-valid scoped access token never rotates the refresh cookie on every
		// request -- only `refreshScoped` (once the access token itself expires) does, see `isAuthed.ts`.
		expect(res.setHeader).not.toHaveBeenCalled();
	});

	test('isGuildManager passes for the session’s own guild without any Discord call', async () => {
		const [{ handle: isAuth }, { handle: isGuildManager }] = isAuthed({
			fallthrough: false,
			isGlobalAdmin: false,
			isGuildManager: true,
		});
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		const req = makeMockedRequest({
			headers: {
				authorization: makeScopedAccessJWT(),
				cookie: `refresh_token=${makeScopedRefreshJWT()}`,
			},
			params: { guildId: SCOPED_GUILD_ID },
		});

		await isAuth(req, res, next);
		expect(next).toHaveBeenCalledWith();
		vi.clearAllMocks();

		fetchMeForScopedSessionMock.mockResolvedValue(makeScopedMe());

		await isGuildManager(req, res, next);

		expect(next).toHaveBeenCalledWith();
		expect(req.guild).toMatchObject({ id: SCOPED_GUILD_ID, meCanManage: true });
		expect(getCurrentUserMock).not.toHaveBeenCalled();
		expect(getGuildsMock).not.toHaveBeenCalled();
	});

	test('isGuildManager rejects a guild the session is not scoped to', async () => {
		const [{ handle: isAuth }, { handle: isGuildManager }] = isAuthed({
			fallthrough: false,
			isGlobalAdmin: false,
			isGuildManager: true,
		});
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		const req = makeMockedRequest({
			headers: {
				authorization: makeScopedAccessJWT(),
				cookie: `refresh_token=${makeScopedRefreshJWT()}`,
			},
			// A different guild than the one the session was minted for.
			params: { guildId: 'a-different-guild' },
		});

		await isAuth(req, res, next);
		expect(next).toHaveBeenCalledWith();
		vi.clearAllMocks();

		await isGuildManager(req, res, next);

		expect(next).toHaveBeenCalledWith(makeExpectedBoom(403, 'you need to be a manager'));
	});

	// The global-admin `ADMINS` bypass inside `isGuildManagerToken`/the `isGuildManager` middleware only ever
	// applies to an oauth session -- otherwise a global admin's own `/dashboard` link would silently work as an
	// any-guild credential, defeating the entire point of scoping it to one guild.
	test('the global-admin bypass does not widen a scoped session past its own guild', async () => {
		const [{ handle: isAuth }, { handle: isGuildManager }] = isAuthed({
			fallthrough: false,
			isGlobalAdmin: false,
			isGuildManager: true,
		});
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		const req = makeMockedRequest({
			headers: {
				authorization: makeScopedAccessJWT({ sub: ADMIN_USER_ID }),
				cookie: `refresh_token=${makeScopedRefreshJWT({ sub: ADMIN_USER_ID })}`,
			},
			params: { guildId: 'a-different-guild' },
		});

		await isAuth(req, res, next);
		expect(next).toHaveBeenCalledWith();
		vi.clearAllMocks();

		await isGuildManager(req, res, next);

		expect(next).toHaveBeenCalledWith(makeExpectedBoom(403, 'you need to be a manager'));
	});

	test('allowScopedSession: false rejects a scoped session even on its own matching guild', async () => {
		// `allowScopedSession: false` inserts its own denial middleware ahead of the `isGuildManager` one --
		// three elements this time, not two.
		const [{ handle: isAuth }, { handle: denyScoped }] = isAuthed({
			fallthrough: false,
			isGlobalAdmin: false,
			isGuildManager: true,
			allowScopedSession: false,
		});
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		const req = makeMockedRequest({
			headers: {
				authorization: makeScopedAccessJWT(),
				cookie: `refresh_token=${makeScopedRefreshJWT()}`,
			},
			params: { guildId: SCOPED_GUILD_ID },
		});

		await isAuth(req, res, next);
		expect(next).toHaveBeenCalledWith();
		vi.clearAllMocks();

		await denyScoped(req, res, next);
		expect(next).toHaveBeenCalledWith(makeExpectedBoom(403, 'not available via a /dashboard session'));
	});

	test('a dashboard-link token is rejected as a malformed access token, never treated as a session', async () => {
		const [{ handle: isAuth }] = isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: false });
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		await isAuth(
			makeMockedRequest({
				headers: {
					authorization: makeDashboardLinkJWT(),
					cookie: `refresh_token=${makeScopedRefreshJWT()}`,
				},
			}),
			res,
			next,
		);

		expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'malformed access token'));
	});

	test('a scoped access token paired with an oauth refresh cookie is rejected as tampered', async () => {
		const [{ handle: isAuth }] = isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: false });
		const res = new MockedResponse();
		await attachHttpUtils()({} as unknown as Request, res, vi.fn());

		await isAuth(
			makeMockedRequest({
				headers: {
					authorization: makeScopedAccessJWT(),
					cookie: `refresh_token=${makeRefreshJWT()}`,
				},
			}),
			res,
			next,
		);

		expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'malformed access token'));
	});

	describe('refreshing an expired scoped access token', () => {
		test('revoked/expired session forces a re-login', async () => {
			const [{ handle: isAuth }] = isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: false });
			const res = new MockedResponse();
			await attachHttpUtils()({} as unknown as Request, res, vi.fn());

			isDashboardSessionLiveMock.mockResolvedValue(false);

			await isAuth(
				makeMockedRequest({
					headers: {
						authorization: makeScopedAccessJWT({ expiresIn: 0 }),
						cookie: `refresh_token=${makeScopedRefreshJWT()}`,
					},
				}),
				res,
				next,
			);

			expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'expired or was revoked'));
			expect(res.setHeader).toHaveBeenCalledWith(NewAccessTokenHeader, 'noop');
			expect(res.setHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('refresh_token=noop'));
		});

		test('a session past its absolute cap forces a re-login even if still marked live', async () => {
			const [{ handle: isAuth }] = isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: false });
			const res = new MockedResponse();
			await attachHttpUtils()({} as unknown as Request, res, vi.fn());

			isDashboardSessionLiveMock.mockResolvedValue(true);

			await isAuth(
				makeMockedRequest({
					headers: {
						authorization: makeScopedAccessJWT({ expiresIn: 0 }),
						cookie: `refresh_token=${makeScopedRefreshJWT({ absoluteExpiresAt: new Date(Date.now() - 1_000).toISOString() })}`,
					},
				}),
				res,
				next,
			);

			expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'expired or was revoked'));
		});

		test('a user who lost manage-guild permission is logged out and their session revoked', async () => {
			const [{ handle: isAuth }] = isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: false });
			const res = new MockedResponse();
			await attachHttpUtils()({} as unknown as Request, res, vi.fn());

			isDashboardSessionLiveMock.mockResolvedValue(true);
			fetchMeForScopedSessionMock.mockResolvedValue(makeScopedMe({ meCanManage: false }));

			await isAuth(
				makeMockedRequest({
					headers: {
						authorization: makeScopedAccessJWT({ expiresIn: 0 }),
						cookie: `refresh_token=${makeScopedRefreshJWT()}`,
					},
				}),
				res,
				next,
			);

			expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'no longer manage this guild'));
			expect(revokeDashboardSessionMock).toHaveBeenCalledWith(SCOPED_SID);
		});

		test('a still-manageable session rotates cleanly, clamped to the absolute cap', async () => {
			const [{ handle: isAuth }] = isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: false });
			const res = new MockedResponse();
			await attachHttpUtils()({} as unknown as Request, res, vi.fn());

			isDashboardSessionLiveMock.mockResolvedValue(true);
			fetchMeForScopedSessionMock.mockResolvedValue(makeScopedMe());

			const absoluteExpiresAt = new Date(Date.now() + 10 * 60 * 1_000).toISOString();

			await isAuth(
				makeMockedRequest({
					headers: {
						authorization: makeScopedAccessJWT({ expiresIn: 0 }),
						cookie: `refresh_token=${makeScopedRefreshJWT({ absoluteExpiresAt })}`,
					},
				}),
				res,
				next,
			);

			expect(next).toHaveBeenCalledWith();
			expect(res.setHeader).toHaveBeenCalledWith(NewAccessTokenHeader, expect.any(String));
			expect(fetchMeForScopedSessionMock).toHaveBeenCalledWith(SCOPED_GUILD_ID, USER_ID, expect.anything(), true);

			// The rotated refresh token's own `exp` must never exceed the session's absolute cap -- otherwise
			// rotation would silently turn the 30-minute cap into a sliding window.
			const decoded = decodeSetCookieRefreshToken(res);
			expect(decoded.exp).toBeLessThanOrEqual(Math.floor(new Date(absoluteExpiresAt).getTime() / 1_000));
			expect(decoded['absoluteExpiresAt']).toBe(absoluteExpiresAt);
			expect(decoded['kind']).toBe('scoped');
		});
	});
});
