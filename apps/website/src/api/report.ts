import * as Sentry from '@sentry/nextjs';
import { APIError, SessionRefreshUnavailableError } from './error';

/**
 * Which funnel an event came out of. Kept deliberately small and closed: it is a Sentry *tag*, so it wants the
 * same bounded-cardinality discipline `docs/workflow.md` states for Prometheus labels.
 */
export type ReportSource = 'boundary' | 'button' | 'global-boundary' | 'mutation' | 'prefetch' | 'query' | 'ws';

/**
 * Ceiling on events one page load may send. This is the most important control in the file: GlitchTip
 * documents no ingestion quota or per-project throttle, `services/api` has no rate limiting anywhere, and the
 * instance writes into the *product* Postgres -- so without a client-side bound, one render loop in one open
 * tab is an unbounded writer against the database the dashboard itself depends on.
 *
 * Browser-only. On the server this module lives for the lifetime of the Vercel function rather than for a page
 * view, so a module-scoped counter there would permanently silence a warm instance rather than bound a burst.
 */
const MAX_EVENTS_PER_PAGE_LOAD = 20;
let eventsThisPageLoad = 0;

/**
 * `redirect()` and `notFound()` unwind by throwing, so they reach `error.tsx` and `onRequestError` looking
 * exactly like failures. Next tags them with a `digest` that is one of its own sentinels -- the spelling has
 * moved across releases (`NEXT_NOT_FOUND`, later `NEXT_HTTP_ERROR_FALLBACK;404`), so match the `NEXT_` prefix
 * rather than any single value. A real production digest is a numeric hash, so the prefix is unambiguous.
 */
function isNextControlFlow(error: unknown): boolean {
	const digest: unknown = (error as { digest?: unknown } | null | undefined)?.digest;
	return typeof digest === 'string' && digest.startsWith('NEXT_');
}

/**
 * The domain policy: what is worth an event at all.
 *
 * The bar is "would this make us change the code". Almost everything a 4xx represents here is the product
 * working -- a session expiring, a permission the user lacks, a name already taken -- and each already has
 * dedicated UI (`UserErrorHandler`, `mapApiErrorToFieldErrors`, `ErrorBanner`). Reporting those would make
 * routine traffic, by volume, essentially the entire contents of the instance.
 */
export function shouldReport(error: unknown, source?: ReportSource): boolean {
	if (isNextControlFlow(error)) {
		return false;
	}

	// Expected on every SSR pass of a live session by construction (#384) -- the server forwards cookies it
	// cannot store, so the API refuses to renew through it. Reporting this would make it the loudest thing in
	// the instance on day one, and it is not a fault.
	if (error instanceof SessionRefreshUnavailableError) {
		return false;
	}

	if (error instanceof APIError) {
		if (!error.isClientError()) {
			return true;
		}

		// One carve-out in the 4xx range: a *mutation* rejected by the API's own zod schema means the dashboard
		// built a payload that the schema it shares with the API refuses. That is a frontend bug, not a user
		// doing something unsupported. The same 400 on a read is far more likely to be a hand-edited URL.
		return error.statusCode === 400 && error.validationErrors !== undefined && source === 'mutation';
	}

	return true;
}

interface ReportContext {
	readonly digest?: string | undefined;
	readonly queryKey?: readonly unknown[] | undefined;
	readonly source: ReportSource;
}

/**
 * The only way this app sends an error anywhere. Every funnel -- `QueryCache.onError`, `Button`'s catch,
 * `prefetch`, `ws`, the two boundaries -- routes through here so the policy above lives in exactly one place.
 *
 * Silently does nothing when no DSN is configured, which is every environment except production.
 */
export function reportError(error: unknown, context: ReportContext): void {
	if (!shouldReport(error, context.source)) {
		return;
	}

	if (typeof window !== 'undefined') {
		if (eventsThisPageLoad >= MAX_EVENTS_PER_PAGE_LOAD) {
			return;
		}

		eventsThisPageLoad += 1;
	}

	const tags: Record<string, string> = { source: context.source };

	if (error instanceof APIError) {
		tags['api.status_code'] = String(error.statusCode);
		tags['api.error'] = error.error;

		if (error.conflictField !== undefined) {
			tags['api.conflict_field'] = error.conflictField;
		}
	}

	// In production Next replaces a server-thrown error's message with a generic one and attaches this digest.
	// The real message and stack arrive separately via `onRequestError`, and this tag is the only thing that
	// joins the two events -- without it they are unrelatable.
	if (context.digest !== undefined) {
		tags['digest'] = context.digest;
	}

	// First two segments only (`api.ama`, `api.modmail`, ...). The full key carries guild and entity ids, and a
	// tag is indexed -- the cardinality rule that keeps guild ids out of Prometheus labels applies here for the
	// same reason.
	if (context.queryKey !== undefined) {
		tags['query_key'] = context.queryKey.slice(0, 2).join('.');
	}

	Sentry.captureException(error, { tags });
}

/**
 * Test seam. The budget is module state, so a test asserting the cap would otherwise leak into the next one.
 */
export function resetEventBudgetForTesting(): void {
	eventsThisPageLoad = 0;
}
