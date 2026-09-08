import { shouldReport } from '@chatsift/web-core/api/report';
import * as Sentry from '@sentry/nextjs';
import { isSocialCrawler } from '@/utils/crawlers';

/**
 * Browser-side error reporting (#386), pointed at our self-hosted GlitchTip rather than sentry.io.
 *
 * Lives under `src/` rather than the package root because this app uses a src directory: Next resolves it
 * from either, but `apps/website/turbo.json` only lists `src/**` in the build task's `inputs`, so at the root
 * it would be invisible to the cache key and edits here would replay a stale build.
 *
 * The DSN is a build-time inlined `NEXT_PUBLIC_` value set only on Vercel's Production environment. Absent --
 * local dev, PR previews, a contributor's machine, CI -- `Sentry.init` never runs, so the SDK installs no
 * global handlers at all and this file costs nothing.
 */
const dsn = process.env['NEXT_PUBLIC_GLITCHTIP_DSN'];

/**
 * Automation gets no SDK. Not a `beforeSend` filter, because not initialising is strictly better: no global
 * handlers, no breadcrumb recording, no fetch instrumentation.
 *
 * `isSocialCrawler` is reused rather than re-regexed (it is the same population), but note it was written for
 * a different question -- `proxy.ts` uses it to decide who may skip the OAuth redirect (#295). It is
 * deliberately an allowlist of link unfurlers with no general search crawler on it, so this pairs it with
 * `navigator.webdriver` to cover headless automation, which is the half that actually generates noise.
 */
function isAutomatedClient(): boolean {
	return navigator.webdriver || isSocialCrawler(navigator.userAgent);
}

if (dsn && !isAutomatedClient()) {
	Sentry.init({
		dsn,
		// Errors only. Traces, sessions, replays and logs are each a second, higher-volume event stream, and
		// every one of them lands in the Postgres the product itself runs on. See the ADR.
		tracesSampleRate: 0,
		integrations: (integrations) => integrations.filter((integration) => integration.name !== 'BrowserSession'),
		// An allowlist rather than a blocklist, and that asymmetry is the point: every byte of our JS is served
		// from this origin, so one entry excludes browser extensions, injected translation and analytics
		// scripts, and whatever else ships next year. A `denyUrls` list is an endless game of whack-a-mole.
		allowUrls: [/^https:\/\/(?:[\w-]+\.)*automoderator\.app\//],
		// `allowUrls` matches on frame URL, so anything arriving with no usable frame slips past it. These are
		// the extension schemes that do exactly that.
		denyUrls: [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari(?:-web)?-extension:\/\//],
		ignoreErrors: [
			// Benign and unactionable: fired by layout thrash in perfectly working UIs.
			'ResizeObserver loop limit exceeded',
			'ResizeObserver loop completed with undelivered notifications',
			// A cross-origin script threw and the browser withheld the details. Nothing to act on.
			/^Script error\.?$/,
			'Non-Error promise rejection captured',
			// The aborted-navigation and offline family. This dashboard fires a lot of queries per page, so a
			// user navigating away mid-flight is routine rather than a fault.
			'AbortError',
			'The operation was aborted',
			'Failed to fetch',
			'NetworkError when attempting to fetch resource',
			'Load failed',
		],
		beforeSend(event, hint) {
			// Events raised through `reportError` have already been through `shouldReport` and carry a `source`
			// tag. They must pass straight through: re-running the policy here without a source would drop the
			// mutation-400 carve-out that `reportError` deliberately let past.
			if (event.tags?.['source'] !== undefined) {
				return event;
			}

			// Everything else arrived via a global handler we do not control -- `window.onerror`,
			// `unhandledrejection`, the SDK's own instrumentation -- so apply the policy as a backstop.
			return shouldReport(hint.originalException) ? event : null;
		},
	});
}
