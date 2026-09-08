import { afterEach, expect, test, vi } from 'vitest';
import { APIError, SessionRefreshUnavailableError } from '../error';
import { reportError, resetEventBudgetForTesting, shouldReport } from '../report';

// `report.ts` imports the SDK at module scope. Stubbed so these stay pure-logic tests that neither pull in
// the real client nor depend on whether a DSN happens to be configured.
const captureException = vi.fn();
vi.mock('@sentry/nextjs', () => ({
	captureException: (...args: unknown[]) => captureException(...args),
}));

afterEach(() => {
	captureException.mockClear();
	resetEventBudgetForTesting();
	vi.unstubAllGlobals();
});

// The property that matters most: routine product behaviour must not reach the instance. A 401 fires on every
// session expiry and a 403 on every permission the user lacks, so getting this wrong doesn't add noise, it
// makes the noise the entire contents of a database the product itself shares.
test('routine 4xx is not worth an event', () => {
	for (const statusCode of [400, 401, 403, 404, 409, 429]) {
		expect(shouldReport(new APIError(statusCode, 'Error', 'nope'), 'query'), `${statusCode}`).toBe(false);
	}
});

test('5xx always is', () => {
	for (const statusCode of [500, 502, 503]) {
		expect(shouldReport(new APIError(statusCode, 'Error', 'boom'), 'query'), `${statusCode}`).toBe(true);
	}
});

// The one carve-out in the 4xx range, and it is source-dependent: the same status means different things
// depending on who produced it.
test('a validation 400 counts only when a mutation caused it', () => {
	const validation = new APIError(400, 'Bad Request', 'invalid', { errors: ['required'] });

	// We built a payload our own shared schema rejects -- a frontend bug.
	expect(shouldReport(validation, 'mutation')).toBe(true);
	// The same response on a read is far more likely to be a hand-edited URL.
	expect(shouldReport(validation, 'query')).toBe(false);
	// A 400 with no validation tree isn't the schema disagreeing with us, whoever asked.
	expect(shouldReport(new APIError(400, 'Bad Request', 'invalid'), 'mutation')).toBe(false);
});

// Expected on every SSR pass of a live session (#384). Reporting it would make it the single loudest thing in
// the instance on day one, and it is not a fault.
test('an SSR session refresh that could not resolve is never reported', () => {
	expect(shouldReport(new SessionRefreshUnavailableError(), 'prefetch')).toBe(false);
});

// `redirect()` and `notFound()` unwind by throwing, so they arrive looking exactly like failures. The sentinel
// has been spelled differently across Next releases, hence matching the prefix rather than a literal.
test("Next's own control flow is not an error", () => {
	for (const digest of ['NEXT_REDIRECT;replace;/dashboard;307', 'NEXT_NOT_FOUND', 'NEXT_HTTP_ERROR_FALLBACK;404']) {
		expect(shouldReport(Object.assign(new Error('unwind'), { digest }), 'boundary'), digest).toBe(false);
	}

	// A real production digest is a hash, and must not be mistaken for control flow.
	expect(shouldReport(Object.assign(new Error('real'), { digest: '1927494ght' }), 'boundary')).toBe(true);
});

test('a plain exception is reported', () => {
	expect(shouldReport(new TypeError('x is not a function'), 'boundary')).toBe(true);
});

// The safety net that matters: GlitchTip documents no ingestion quota and the API has no rate limiting, so a
// render loop in one open tab is otherwise an unbounded writer against the product database.
test('the browser event budget caps a runaway page', () => {
	vi.stubGlobal('window', {});

	for (let index = 0; index < 50; index++) {
		reportError(new Error(`burst ${index}`), { source: 'boundary' });
	}

	expect(captureException).toHaveBeenCalledTimes(20);
});

// The budget is deliberately browser-only: on the server this module lives for the life of the Vercel
// function rather than a page view, so a counter there would permanently silence a warm instance.
test('the budget does not apply on the server', () => {
	for (let index = 0; index < 50; index++) {
		reportError(new Error(`burst ${index}`), { source: 'prefetch' });
	}

	expect(captureException).toHaveBeenCalledTimes(50);
});

test('an API error is tagged so it can be triaged without opening the API logs', () => {
	reportError(new APIError(500, 'Internal Server Error', 'boom', undefined, 'name'), {
		source: 'mutation',
		queryKey: ['api', 'ama', '1425493115053019319', 'list'],
	});

	expect(captureException).toHaveBeenCalledTimes(1);
	expect(captureException.mock.calls[0]?.[1]).toStrictEqual({
		tags: {
			source: 'mutation',
			'api.status_code': '500',
			'api.error': 'Internal Server Error',
			'api.conflict_field': 'name',
			// First two segments only -- the rest carries a guild id, and tags are indexed.
			query_key: 'api.ama',
		},
	});
});
