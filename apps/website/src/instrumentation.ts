import * as Sentry from '@sentry/nextjs';
import type { Instrumentation } from 'next';
import { shouldReport } from '@/api/report';

/**
 * Server-side error reporting (#386) for the Vercel runtimes.
 *
 * This is the half that sees what a production `digest` is hiding: Next replaces a server-thrown error's
 * message with a generic string before it reaches the browser, so `error.tsx` only ever gets the digest. The
 * event raised here carries the real message and stack, and the shared digest tag is what joins the two.
 *
 * Same DSN gating as the client: unset outside Vercel Production, so `register` is a no-op everywhere else.
 */
export function register(): void {
	const dsn = process.env['NEXT_PUBLIC_GLITCHTIP_DSN'];

	if (!dsn) {
		return;
	}

	Sentry.init({
		dsn,
		tracesSampleRate: 0,
		beforeSend(event, hint) {
			// Same reasoning as the client's: anything already carrying a `source` tag came through
			// `reportError` and has been through the policy once already.
			if (event.tags?.['source'] !== undefined) {
				return event;
			}

			return shouldReport(hint.originalException) ? event : null;
		},
	});
}

/**
 * Next's hook for errors thrown while rendering on the server -- SSR and RSC alike. Without it those are
 * invisible to us: they surface to the user as a digest and are otherwise only in Vercel's own function logs.
 *
 * Filtered rather than handed straight to `captureRequestError`, because `redirect()` and `notFound()` unwind
 * by throwing and land here on every single use.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
	if (!shouldReport(error)) {
		return;
	}

	// `captureRequestError` attaches Next's own routing context but **not** the digest -- it sets a `nextjs`
	// context and a transaction name, nothing more. So the tag has to be set here, on a surrounding scope, or
	// the join this whole file depends on does not exist: the boundary event would carry a `digest` tag and
	// this one would carry nothing to match it against.
	const digest: unknown = (error as { digest?: unknown } | null | undefined)?.digest;

	Sentry.withScope((scope) => {
		if (typeof digest === 'string') {
			scope.setTag('digest', digest);
		}

		Sentry.captureRequestError(error, request, context);
	});
};
