# ADR 0003: Self-hosted GlitchTip for frontend error reporting

- **Status:** Accepted, implemented for #386 (2026-09-07)
- **Date:** 2026-09-07
- **Related:** [workflow.md](../workflow.md#frontend-error-reporting-386) (runbook), [frontend.md](../frontend.md) (error UI conventions)

## Problem

`apps/website/next.config.mjs` carried `productionBrowserSourceMaps: true`, which publishes a `.js.map` for
every chunk of the dashboard. We want to stop doing that.

The catch is that the flag was, in practice, the only thing making a production stack trace readable. The
status quo was a straight trade of source disclosure for debuggability, and removing one half of it without
replacing the other just leaves minified frames. So the requirement this issue actually generates is
**symbolication**, not error capture — somewhere that holds the maps privately and resolves frames on our
side.

Capture was missing too, and comprehensively:

- **No error boundaries anywhere in the repo** — no `error.tsx`, no `global-error.tsx`, no
  `componentDidCatch`. A render-time throw in any client component fell through to Next's built-in default
  ("Application error: a client-side exception has occurred") and was logged nowhere.
- Every error path terminated in `console.error` — 19 call sites across 14 files, with no logging abstraction.
  Nothing left the browser.
- No `window.onerror` or `unhandledrejection` net, so anything outside `Button.onPress` and react-query was
  invisible.
- No `MutationCache`, so mutation coverage was a function of whether a `Button` happened to trigger it.
- `prefetch()` (`src/api/fetch.ts`) and `ws.ts` swallow errors _by design_, and both were entirely silent. The
  first wraps the root layout's `me` query, so every SSR session-resolution failure in production was a line
  in a Vercel function log nobody reads.
- No `instrumentation.ts`, so server-side SSR/RSC failures had no hook either.

One structural fact shapes every option below: **the dashboard cannot reach any of our observability stack.**
It deploys to Vercel, is absent from `docker-compose.yml`, is never copied by the root `Dockerfile`, and has
no Caddy route. It can neither write the host log volume nor be scraped by Prometheus.

## Requirements

1. Symbolicated stack traces from a build whose maps are **not** publicly served.
2. Capture across the three surfaces that exist: browser runtime, React render, and Next server-side.
3. No unbounded new writer against infrastructure the product depends on.
4. Alerting that does not depend on the thing it is alerting about.

## Options considered

| Option                              | Symbolication              | Data locality                                   | Cost                                                        |
| ----------------------------------- | -------------------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| **Do nothing**                      | Public maps, by hand       | —                                               | The disclosure we want gone                                 |
| **Hosted Sentry**                   | Best in class              | Events and maps leave the stack; vendor account | ~5k events/mo free tier                                     |
| **Self-hosted Sentry**              | Best in class              | Ours                                            | Many containers, Kafka/ClickHouse/Snuba; far too heavy here |
| **Custom ingest on `services/api`** | **Hand-rolled**            | Ours                                            | Zero new deps, but see below                                |
| **GlitchTip (self-hosted)**         | Sentry-protocol, debug IDs | Ours                                            | One container, a shared Postgres tenant                     |

The custom option deserves the most explanation, because on this repo's instincts it should have won — the
stack has repeatedly chosen zero-dependency solutions over new packages (see #270's rationale). It loses on
two specific points:

- **Symbolication is the requirement, and it is the one part that is genuinely hard.** A custom ingest route
  would be the easy 20%: a counter, a pino line, a Discord relay through the existing `/v3/logs/webhook`
  pattern. Resolving a minified frame means storing per-release map artifacts, matching them by debug ID, and
  resolving positions through the `source-map` library. That is a mini-Sentry, and it contradicts choosing the
  simplest implementation that fully meets the requirement.
- **There is nothing left to plug into.** Loki and Promtail were deliberately removed (`1ef4c014`,
  `6e56307d`), and `build/grafana/provisioning/alerting/rules.yml` explicitly `deleteRules` the old
  `elevated-error-log-rate` alert along with them. So a custom sink would not be reusing existing
  infrastructure — it would be rebuilding the log search and error-rate alerting that were just torn out.

Hosted Sentry loses on data locality alone: error payloads carry Discord user and guild ids and dashboard
route paths, and this stack self-hosts everything else it can.

## Decision

**Self-hosted GlitchTip**, reached through the stock `@sentry/nextjs` SDK pointed at our own `sentryUrl`.

- One container (`glitchtip/glitchtip:6.2.6`, `SERVER_ROLE`/`GLITCHTIP_EMBED_WORKER` embedding the worker),
  behind Caddy at `errors.automoderator.app`, on the `monitoring` profile.
- **Shares the existing Postgres** via a `glitchtip` role and database (`build/postgres/init/03-glitchtip.sh`)
  rather than running its own instance — one volume to back up and upgrade.
- **`VALKEY_URL` is deliberately blank.** GlitchTip falls back to Postgres for its task queue and cache, which
  keeps it off the shared `redis`. That Redis runs with no `maxmemory` and holds `bot-core`'s replica leases,
  the per-replica guild lists and the message cache; evicting a lease double-claims a shard index.
- The upload token is named `SENTRY_AUTH_TOKEN` despite the vendor being GlitchTip, because both the bundler
  plugin and `glitchtip-cli` default to that name. It is not a copy-paste mistake.

### The source-map mechanic, which is the whole point and is counter-intuitive

`withSentryConfig`'s `maybeEnableTurbopackSourcemaps` bails out the instant it sees
`productionBrowserSourceMaps` defined _at all_. Under Turbopack the SDK has no webpack `devtool` to override,
so Next's own flag is the only thing that makes browser maps exist. Therefore:

- Setting it **`false`** means no maps are generated, nothing is uploaded, and every stack stays minified —
  silently. The intuitive fix is the wrong one.
- Leaving it **`true`** also trips the bail-out, which skips the automatic `deleteSourcemapsAfterUpload`, so
  maps are uploaded _and_ still served. #386 unfixed while appearing fixed.
- Leaving it **undefined** is the only state that gets both halves.

`next.config.mjs` therefore omits the key entirely, and gates the whole mechanism on `sourcemaps.disable`
instead — which is the _first_ condition that bail-out checks, so a build with no upload token never has maps
enabled in the first place.

Measured against 16.2.10 rather than assumed, since the interaction is not documented:

| Build                                                            | `.map` under `.next/static` | `sourceMappingURL` refs |
| ---------------------------------------------------------------- | --------------------------- | ----------------------- |
| Before this change (`productionBrowserSourceMaps: true`, no SDK) | 100                         | 134                     |
| Wrapped, no upload token                                         | 0                           | 0                       |
| Wrapped, token present, deletion off                             | 100                         | 134                     |
| **Wrapped, token present, deletion on**                          | **0**                       | **0**                   |

So maps are generated only where they can be uploaded, and are gone from the deployed output either way. One
consequence worth knowing: **deletion runs even when the upload fails** — an unreachable host still produced a
zero-exit build with the maps deleted. That fails in the safe direction (symbolication is lost, source is not
disclosed), but on its own it makes a broken upload invisible from outside, shipping a release nobody can
symbolicate and defeating the point of the change.

An `errorHandler` that rethrows closes that: a failed upload fails the build, so a green production build is
itself the evidence that the maps landed, rather than a warning in a log someone has to remember to read. The
trade is a deploy-time dependency on GlitchTip being reachable — deliberately accepted, with clearing
`SENTRY_AUTH_TOKEN` in Vercel as the documented escape hatch when something has to ship during an outage.

### Deliberately rejected

- **Session Replay, tracing, profiling, OTLP log ingestion.** Each is a second, higher-volume event stream
  landing in the product's own database. Errors only; `GLITCHTIP_ENABLE_LOGS` is off for the same reason Loki
  was removed.
- **`tunnelRoute`** (proxying events same-origin past ad blockers). Costs a Vercel function invocation per
  event and contradicts direct ingest.
- **`react-error-boundary`.** React 19's supported hooks (`onUncaughtError`, `onCaughtError`) are
  `createRoot`/`hydrateRoot` options, and Next owns the root — they are unreachable from the App Router. The
  boundaries plus the SDK's global handlers are the whole available surface.

## Consequences

- **A Django tenant now lives in the product Postgres.** Mitigated on both levers that matter: the role is
  excluded from postgres-exporter's `stat_statements` collector and exempted from the slow-query log, so
  #270's tooling does not silently degrade under Django's statement churn against a fixed
  `pg_stat_statements.max=5000`. Retention starts at 30 days rather than the upstream 90.
- **One new client dependency**, ~30 kB gzipped with Replay excluded from the bundle.
- **No ingestion quota exists.** GlitchTip documents retention but no per-project throttle, and the API has no
  rate limiting anywhere. Volume control is therefore client-side and load-bearing, not decorative:
  `src/api/report.ts` drops routine 4xx, `SessionRefreshUnavailableError` and Next's control-flow throws, and
  caps events per page load.
- **No component stacks in production.** Next passes `error.tsx` only `{ error, reset }`, and React 19's
  `captureOwnerStack` is dev-only. Symbolicated frames are the entire story, which is what makes the map
  upload load-bearing rather than a nicety.
- **Expect double capture.** React 19 routes uncaught render errors through `window.reportError`, which the
  SDK's global handler sees, _and_ `error.tsx` captures the same object. `dedupeIntegration` is on by default
  and collapses them.
- **Alerting is split.** GlitchTip's own project alerts cover error rate — the semantics the deleted
  `elevated-error-log-rate` rule had, now run by the system that actually holds the data. Grafana covers
  GlitchTip _being gone_ (`glitchtip-absent`), because a crashed instance reports nothing and looks exactly
  like a quiet week. Frontend error alerting deliberately does not go through Grafana at all: Grafana cannot
  see Vercel-side errors.
- **Source maps age out.** GlitchTip prunes uploaded artifacts on its own retention, so a sufficiently old
  release stops symbolicating.
- Server-side reporting for `services/api` and the bots is **out of scope**. They already have structured pino
  logs and the Dozzle relay, and a different failure model.
