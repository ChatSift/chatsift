/* eslint-disable @typescript-eslint/unbound-method */

import { Http2ServerResponse } from 'node:http2';
import {
	AppealsRefreshTokenCookie,
	createDatabase,
	createLogger,
	createRedis,
	encrypt,
	getContext,
	initContext,
	NewAccessTokenHeader,
	RefreshTokenCookie,
} from '@chatsift/backend-core';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'polka';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { TypedMiddleware } from '../../core/route.js';
import { attachHttpUtils } from '../attachHttpUtils.js';
import { isAppealsAuthed } from '../isAppealsAuthed.js';
import { isAuthed } from '../isAuthed.js';

vi.mock('http2');

vi.mock('@chatsift/backend-core', async (importActual) => {
	const { stubTestEnv } = await import('../../__tests__/stubEnv.js');
	stubTestEnv();

	const actual = (await importActual()) as typeof import('@chatsift/backend-core');

	return {
		...actual,
		createDatabase: () => vi.fn(async () => []),
		createRedis: () => ({
			get: vi.fn(async () => null),
			exists: vi.fn(async () => 0),
			set: vi.fn(async () => 'OK'),
			sMembers: vi.fn(async () => []),
			sRem: vi.fn(async () => 0),
		}),
	};
});

// `isAuthed` (imported for the cross-direction test below) reaches `util/me.js` -> `util/discordAPI.js`, which
// builds its `REST` clients at module scope off `getContext()` -- i.e. before `beforeAll` has initialized one.
// Mocked at the same boundary `isAuthed.test.ts` uses; none of these are reached, since every rejection here
// happens before any Discord call.
vi.mock('../../util/discordAPI.js', () => ({
	discordAPIOAuth: { oauth2: { refreshToken: vi.fn() }, users: { getCurrent: vi.fn(), getGuilds: vi.fn() } },
	discordAPIAppeals: {},
	apiForGuild: vi.fn(),
	resolveGuildAPI: vi.fn(),
	roundRobinAPI: vi.fn(),
	APIMapping: {},
}));

beforeAll(async () => {
	const logger = createLogger('api');
	const db = createDatabase();
	const redis = await createRedis(logger);
	initContext({ db, logger, redis });
});

const USER_ID = '223703707118731264';
const OTHER_USER_ID = '104425482757357568';

const makeExpectedBoom = (statusCode: number, message: string) =>
	expect.objectContaining({
		output: expect.objectContaining({
			payload: expect.objectContaining({ statusCode, message: expect.stringContaining(message) }),
		}),
	});

/**
 * One helper for both halves of the pair, since an appeals token *is* just `{ kind, refresh, sub }` -- the
 * `refresh` flag is the only thing that distinguishes them, which is exactly what several of these tests are
 * about. `kind` and `refresh` are overridable so a test can mint a deliberately wrong one.
 */
const makeAppealsJWT = ({
	refresh,
	sub = USER_ID,
	expiresIn = refresh ? 30 * 24 * 60 * 60 : 5 * 60,
	kind = 'appeals',
}: {
	expiresIn?: number;
	kind?: string;
	refresh: boolean;
	sub?: string;
}) =>
	jwt.sign({ kind, refresh, iat: Math.floor(Date.now() / 1_000), sub }, getContext().env.ENCRYPTION_KEY, {
		expiresIn,
	});

/**
 * A *dashboard* refresh token, signed with the same key -- which is exactly why the `kind` discriminator has to
 * do the work here rather than the signature.
 */
const makeDashboardRefreshJWT = () =>
	jwt.sign(
		{
			kind: 'oauth',
			refresh: true,
			iat: Math.floor(Date.now() / 1_000),
			sub: USER_ID,
			discordAccessToken: encrypt('access'),
			discordAccessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
			discordRefreshToken: encrypt('refresh'),
		},
		getContext().env.ENCRYPTION_KEY,
		{ expiresIn: 30 * 24 * 60 * 60 },
	);

const makeMockedRequest = (data: any) => ({ logger: getContext().logger, ...data }) as unknown as Request;
const MockedResponse = Http2ServerResponse as unknown as new () => Response;
const next = vi.fn();

// Widened deliberately: the two overloads of `isAppealsAuthed` differ in whether `appellant` is optional, and
// this suite drives both.
async function run(middleware: TypedMiddleware<any>, req: Request, res: Response): Promise<void> {
	await attachHttpUtils()({} as unknown as Request, res, vi.fn());
	await middleware.handle(req, res, next);
}

afterEach(() => {
	vi.clearAllMocks();
});

test('a valid appeals pair authenticates', async () => {
	const res = new MockedResponse();
	const req = makeMockedRequest({
		headers: {
			authorization: makeAppealsJWT({ refresh: false }),
			cookie: `${AppealsRefreshTokenCookie}=${makeAppealsJWT({ refresh: true })}`,
		},
	});

	await run(isAppealsAuthed({ fallthrough: false })[0]!, req, res);

	expect(next).toHaveBeenCalledWith();
	expect(req.appellant?.sub).toBe(USER_ID);
});

test('a dashboard refresh token placed in the appeals cookie is rejected', async () => {
	// The crossing this middleware exists to make impossible. Both JWTs are signed with the same key, so
	// nothing but the `kind` discriminator distinguishes them.
	const res = new MockedResponse();
	const req = makeMockedRequest({
		headers: { cookie: `${AppealsRefreshTokenCookie}=${makeDashboardRefreshJWT()}` },
	});

	await run(isAppealsAuthed({ fallthrough: false })[0]!, req, res);

	expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'malformed appeals session'));
	expect(req.appellant).toBeUndefined();
});

test('an appeals refresh token placed in the dashboard cookie is rejected', async () => {
	// The same crossing in the other direction, through the other middleware -- neither session can reach the
	// other's routes, and this is the half that `isAuthed` is responsible for.
	const res = new MockedResponse();
	const req = makeMockedRequest({
		headers: { cookie: `${RefreshTokenCookie}=${makeAppealsJWT({ refresh: true })}` },
	});

	await attachHttpUtils()({} as unknown as Request, res, vi.fn());
	await isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: false })[0]!.handle(req, res, next);

	expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'malformed refresh token'));
	expect(req.tokens).toBeUndefined();
});

test('a dashboard session cookie alone is not an appeals session', async () => {
	const res = new MockedResponse();
	const req = makeMockedRequest({ headers: { cookie: `${RefreshTokenCookie}=${makeDashboardRefreshJWT()}` } });

	await run(isAppealsAuthed({ fallthrough: false })[0]!, req, res);

	expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'missing appeals session'));
});

test('an access token minted for a different account than the cookie is rejected', async () => {
	const res = new MockedResponse();
	const req = makeMockedRequest({
		headers: {
			authorization: makeAppealsJWT({ refresh: false, sub: OTHER_USER_ID }),
			cookie: `${AppealsRefreshTokenCookie}=${makeAppealsJWT({ refresh: true, sub: USER_ID })}`,
		},
	});

	await run(isAppealsAuthed({ fallthrough: false })[0]!, req, res);

	expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'malformed appeals session'));
	expect(req.appellant).toBeUndefined();
});

test('a refresh token replayed as an access token is rejected', async () => {
	const res = new MockedResponse();
	const req = makeMockedRequest({
		headers: {
			authorization: makeAppealsJWT({ refresh: true }),
			cookie: `${AppealsRefreshTokenCookie}=${makeAppealsJWT({ refresh: true })}`,
		},
	});

	await run(isAppealsAuthed({ fallthrough: false })[0]!, req, res);

	expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'malformed appeals session'));
});

test('an access token replayed as the refresh cookie is rejected', async () => {
	const res = new MockedResponse();
	const req = makeMockedRequest({
		headers: { cookie: `${AppealsRefreshTokenCookie}=${makeAppealsJWT({ refresh: false })}` },
	});

	await run(isAppealsAuthed({ fallthrough: false })[0]!, req, res);

	expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'malformed appeals session'));
});

test('an expired access token is reminted from the cookie', async () => {
	const res = new MockedResponse();
	const req = makeMockedRequest({
		headers: {
			authorization: makeAppealsJWT({ refresh: false, expiresIn: -60 }),
			cookie: `${AppealsRefreshTokenCookie}=${makeAppealsJWT({ refresh: true })}`,
		},
	});

	await run(isAppealsAuthed({ fallthrough: false })[0]!, req, res);

	expect(next).toHaveBeenCalledWith();
	expect(req.appellant?.sub).toBe(USER_ID);
	expect(res.setHeader).toHaveBeenCalledWith(NewAccessTokenHeader, expect.not.stringMatching(/^noop$/));
	expect(res.setHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining(`${AppealsRefreshTokenCookie}=`));
});

test('an expired refresh cookie clears both halves', async () => {
	const res = new MockedResponse();
	const req = makeMockedRequest({
		headers: { cookie: `${AppealsRefreshTokenCookie}=${makeAppealsJWT({ refresh: true, expiresIn: -60 })}` },
	});

	await run(isAppealsAuthed({ fallthrough: false })[0]!, req, res);

	expect(next).toHaveBeenCalledWith(makeExpectedBoom(401, 'expired appeals session'));
	expect(res.setHeader).toHaveBeenCalledWith(NewAccessTokenHeader, 'noop');
	expect(res.setHeader).toHaveBeenCalledWith(
		'Set-Cookie',
		expect.stringContaining(`${AppealsRefreshTokenCookie}=noop`),
	);
});

test('fallthrough lets an anonymous visitor through with no appellant', async () => {
	// What the auth-start route runs with -- it has to be reachable while logged out, which is the whole point.
	const res = new MockedResponse();
	const req = makeMockedRequest({ headers: {} });

	await run(isAppealsAuthed({ fallthrough: true })[0]!, req, res);

	expect(next).toHaveBeenCalledWith(undefined);
	expect(req.appellant).toBeUndefined();
});
