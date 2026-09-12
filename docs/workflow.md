# Workflow

Conventions for working on the ChatSift rebirth (see [roadmap/00-overview.md](roadmap/00-overview.md) for product context).

## Branching & PRs

- Work happens on feature branches off `main`, one PR per logical change. Suggested branch naming: `<type>/<short-description>` (e.g. `feat/ama-guest-queue`, `refactor/defineRoute-ama-routes`, `docs/roadmap-scaffolding`).
- Squash-merge to `main` with a conventional-commit-style message (see below) — keeps `main`'s history one-commit-per-change even if a branch had many WIP commits.
- Reference the relevant milestone/issue in the PR description (`Closes #123`).
- Global merge gate: `turbo run build lint test format:check` green. Anything with a runtime surface (anything other than docs/tests) also needs a manual pass exercising the change — but see [Verification standard](#verification-standard) for which half of that an agent can actually do and which half is yours.

## Commit messages

This repo uses **commitlint** (`@commitlint/config-angular`) enforced by a `commit-msg` husky hook (`.husky/commit-msg`, `.commitlintrc.json`). Allowed types:

```
chore, build, ci, docs, feat, fix, perf, refactor, revert, style, test, types
```

Format: `<type>(<optional scope>): <subject>`. Scope case isn't enforced; exclamation-mark breaking-change markers aren't enforced either (both disabled in `.commitlintrc.json`). Example: `feat(ama-bot): add guest-review queue handlers`.

## Local environment

`docker-compose.yml` provides `postgres`, `redis`, `dozzle` (log viewer), plus containerized `api`, `ama-bot`, and `modmail-bot` services (and one commented-out `modmail-bot-<partner-slug>` template per custom instance, see below) built from the root `Dockerfile`. For day-to-day development, run `postgres` + `redis` via compose (`docker compose up -d postgres redis`) and the Node services directly via the root `yarn dev:api` / `yarn dev:ama-bot` / `yarn dev:modmail-bot` scripts — each builds the service (and its workspace deps) with turbo, then runs the built `dist/bin.js` with `.env.private`/`.env.public` auto-loaded via `dotenv-cli`. Re-run the script after making changes; there's no watch mode. This is faster than rebuilding containers each time.

Vars that differ between a host-run service and a containerized one (`REDIS_URL_DEV`/`REDIS_URL_PROD`, `API_URL_DEV`/`API_URL_PROD`, `FRONTEND_URL_DEV`/`FRONTEND_URL_PROD`) are all declared in `.env.public` and resolved via `IS_PRODUCTION` (from `.env.private`) in `packages/private/backend-core` — `IS_PRODUCTION=false` locally, so these already point at `127.0.0.1`/`localhost` without any manual overriding.

Environment variables are split `.env.public` (checked in, non-secret defaults) / `.env.private` (gitignored, secrets) — see `.env.private.example` for the required shape.

### Database

Prisma/Kysely are gone as of M1 (#132). The root `db:*` scripts (`dotenv -e .env.private -e .env.public -- yarn workspace @chatsift/db run ...`) wrap `packages/db`'s Atlas/kanel scripts:

- `db:migrate` → `atlas migrate apply`
- `db:migrate:down` → `atlas migrate down`
- `db:gen` → kanel codegen (writes `packages/db/src/generated/`, committed)
- `db:diff` → `atlas migrate diff` (generates a migration from a schema change)

`getContext().db` is now the `postgres.js` raw SQL client (`@chatsift/db`) everywhere — no more `rawDb`/legacy-`db` split.

**kanel gotchas**, if you ever touch `packages/db`'s codegen setup:

- Config file must be `kanel.config.cjs`, not `.js`. kanel's CLI loads it via a bare `require(...)`; under this package's `"type": "module"`, requiring a `.js` file returns the unwrapped ESM-interop `{ default: {...} }` shape instead of the config object, so every option (including `connection`) silently vanishes and kanel falls back to a bare default `pg` connection.
- `getPropertyMetadata` must camelCase row property names (via `@kristiandupont/recase`, `recase('snake', 'camel')`) — kanel only PascalCases type/interface names by default, not properties, so without this override generated types carry snake_case keys while actual query results are camelCase at runtime (per the `postgres.camel` transform above).
- `@electric-sql/pglite` must stay a devDependency even though nothing uses the pglite driver — kanel's CLI crashes on startup without it, due to an unconditional unmet peer `require` inside `extract-pg-schema`'s nested `knex-pglite` dependency.

### Query performance tracking (#270)

Entirely DB-side, zero-dependency (reuses infra already in the stack — Prometheus/Grafana/dozzle — no new npm
packages, no application code). An app-level equivalent (timing queries in `createDb()`) was considered and
deliberately rejected: postgres.js exposes no query-completion event, so the only way to time an individual
`` sql`...` `` call is `Proxy`-wrapping the client or rewriting every call site — not worth it when this DB-side
layer already gives the same signal (which query, how slow) for free.

The `postgres` compose service enables `pg_stat_statements` (`shared_preload_libraries`,
`log_min_duration_statement=${POSTGRES_SLOW_QUERY_LOG_MS:-200}` — slow queries land in dozzle like every other
service's logs) and mounts `build/postgres/init/01-pg-stat-statements.sql`
(`CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`). `log_parameter_max_length=0` is also set, so a slow
statement's logged text stays `$1`/`$2` placeholders — bound values (Discord IDs, ticket/message content, etc.)
never reach the log. A `postgres-exporter` service scrapes it into the existing Prometheus
(`build/prometheus/prometheus.yml`), and the `postgres-overview` Grafana dashboard
(`build/grafana/dashboards/postgres-overview.json`) surfaces connections, cache hit ratio, throughput, locks, and a
top-20-slowest-queries table (from the exporter's native `--collector.stat_statements`, not the deprecated
`queries.yaml`/`--extend.query-path` mechanism — this one is cardinality-bounded by `queryid`, and never stores
bound values either, by design). Two alert rules (`postgres-down`, `postgres-connections-near-limit`) were added to
`build/grafana/provisioning/alerting/rules.yml`, routed through the existing Discord alert webhook automatically.

**One-time manual step for already-provisioned databases** (both local dev and prod — `docker-entrypoint-initdb.d`
scripts only run against a _fresh_ data directory, so the init script above won't fire on an existing
`chatsift-v3-postgres-data` volume):

```sh
./compose exec postgres psql -U chatsift -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
./compose up -d --force-recreate postgres
```

The restart is required because `shared_preload_libraries` is a postmaster-context setting, not reloadable. Run
this yourself on each already-running Postgres (local + prod) — it's not something an agent should run on your
behalf.

#### The exporter's own monitoring role

`postgres-exporter` connects as `chatsift_exporter`, not as `chatsift`. That separation is what makes its scrape
traffic filterable, and it buys two things that are impossible while it shares the application's role:

- **Out of the Grafana top-slowest table** — `--collector.stat_statements.exclude_users=chatsift_exporter` in
  `docker-compose.yml`. Its `pg_stat_user_tables`/`pg_settings` reads run every 15s and otherwise sit at the top
  of a table whose entire purpose is surfacing queries we wrote.
- **Out of the slow-query log** — `ALTER ROLE chatsift_exporter SET log_min_duration_statement = -1`. There is no
  exporter-side equivalent for this one: the log is written by Postgres, so a per-role override is the only
  lever. It is also what makes lowering `POSTGRES_SLOW_QUERY_LOG_MS` worth doing — without it, any threshold low
  enough to catch a query drifting from 3ms to 80ms also logs the exporter forever.

`build/postgres/init/02-monitoring-role.sh` creates it on a fresh volume. **Same one-time manual step as above on
an already-provisioned database** — the password comes from `POSTGRES_EXPORTER_PASSWORD` in `.env.public` (it sits
there rather than in `.env.private` because this role is strictly weaker than the `chatsift` owner whose password is
already checked in beside it, and postgres is never externally reachable):

Run the init script itself rather than a hand-copied version of its SQL — the `init` directory is bind-mounted, so
the script is already inside the running container, and it's idempotent (the role is created only if absent, the
rest re-applies harmlessly):

```sh
./compose exec -e POSTGRES_EXPORTER_PASSWORD="$(grep -m1 '^POSTGRES_EXPORTER_PASSWORD=' .env.public | cut -d= -f2-)" \
  postgres bash /docker-entrypoint-initdb.d/02-monitoring-role.sh
./compose up -d --force-recreate postgres-exporter
```

`-e` is needed because a container's environment is fixed when it is created, so a `postgres` container started
before this variable existed will not have it — passing it on the `exec` avoids restarting the database just to
pick up one variable. It is harmless once the container has been recreated for other reasons.

**Do not re-spell this as a series of `psql -c` flags.** `psql` performs no `:'variable'` interpolation in `-c`
strings — the literal `:'password'` reaches the server, `ALTER ROLE … WITH PASSWORD` fails with a syntax error, and
because the other statements still succeed (and psql exits 0 without `ON_ERROR_STOP`) you get a role that exists,
reads as correctly configured, and cannot authenticate. The symptom is `password authentication failed for user
"chatsift_exporter"` in the exporter's logs while `pg_roles` looks entirely healthy.

Both grants are load-bearing. `pg_monitor` is what stops other roles' query text reading as
`<insufficient privilege>`. The `USAGE ON SCHEMA public` is easy to miss and fails differently: `pg_stat_statements`
is a view in whichever schema the extension was created in, and this database's `public` grants PUBLIC no USAGE, so
the read dies with `permission denied for schema public` before any monitoring privilege is consulted — the
collector then produces nothing at all. Existing rows in
`pg_stat_statements` are still attributed to `chatsift`, so the old exporter entries linger until the view is
reset (`SELECT pg_stat_statements_reset();`) or Postgres restarts — the filter only applies going forward.

### Metrics (#277 and after)

Reuses the same Prometheus/Grafana infra as #270, plus one new npm dependency: `prom-client` in `services/api`. The
API's existing per-route timing middleware (`mountRoute` in `services/api/src/core/server.ts` — already fires for
every route, since it's the first middleware `mountRoute` installs) now also observes an
`http_request_duration_seconds` histogram (`services/api/src/core/metrics.ts`), labelled by `method`, `route` (the
route _pattern_, e.g. `/v3/guilds/:guildId` — not the resolved URL, so cardinality stays bounded), and
`status_code`. Request counts and rates are derived from the same histogram (`_count`/`rate(...)`), no separate
counter needed.

The API exposes this at `GET /metrics` (bare, unversioned — matches the same bare `/metrics` every other scrape
target in `build/prometheus/prometheus.yml` already uses), guarded by a Bearer-token middleware
(`services/api/src/middleware/requireMetricsSecret.ts`, mirroring the Dozzle webhook's `requireWebhookSecret`
shared-secret pattern) rather than a custom header — Prometheus's `scrape_config` has native
`authorization.credentials_file` support, which re-reads the token from disk on every scrape, so rotating the
secret needs no Prometheus restart.

A new `api` job in `build/prometheus/prometheus.yml` scrapes `api:7004` with that credentials file. A new
`api-overview` Grafana dashboard (`build/grafana/dashboards/api-overview.json`) shows request rate by route,
p50/p95/p99 latency, and a per-route summary table.

**Every rate/increase on that dashboard is computed over a `$window` template variable (default `1h`), not
`$__rate_interval`.** This API's traffic is low enough — fractions of a request per second — that a ~5m window
contains zero requests for most individual routes, and the latency queries are ratios: `rate(_sum) / rate(_count)`
becomes `0 / 0` = NaN, and `histogram_quantile` over all-zero buckets is NaN too. Those NaNs then rendered on the
table's _base_ threshold colour (green), so "no data" was indistinguishable from "excellent latency". The summary
table's latency queries now additionally guard on `... > 0` (a `> 0` filter on the denominator, and an
`and on (method, route)` guard for the quantile) so a route with no in-window traffic drops out of the result
entirely and displays as an em dash via a NaN/null value mapping. The table also leads with a raw **Requests**
column — at this volume, a p95 is only worth reading next to the sample count it was computed from. Widen `$window`
to 6h/24h when routes still show an em dash; narrow it to chase a short-lived spike.

**One-time manual step** (same shape as Dozzle's `users.yml` setup in #212 — this is the one thing that can't be
committed to git, since `prometheus.yml` has no env-var-expansion mechanism at all):

```sh
# Same value as METRICS_SECRET in .env.private
echo -n '<your METRICS_SECRET value>' > build/prometheus/metrics_secret
chmod 644 build/prometheus/metrics_secret
./compose up -d --force-recreate prometheus
```

#### Bot feature metrics

Every bot now carries a feature-level taxonomy of its own -- `automoderator-bot` first, then `ama-bot`,
`modmail-bot` and `social-bot` -- each in that service's `src/lib/metrics.ts`, each with its own `prom-client`
`Registry`. The goal is the one stated in
[11-automoderator-port.md](roadmap/11-automoderator-port.md) § Observability: **"is feature N working in prod"
should be answerable without reading logs.**

Three rules hold across all of them:

1. **Collection is unconditional; only exposure is gated.** Counters increment in dev too, because a mislabelled
   or never-incremented metric that only runs in production is a bug you find in production. What
   `ENV.IS_PRODUCTION` gates is _binding the port_ -- see `@chatsift/bot-core`'s `metricsServer.ts`, which all
   four bots share.
2. **Cardinality discipline, non-negotiable.** Never label by `guild_id`, `user_id`, `channel_id`, `message_id`,
   or user content. Every label is drawn from a closed set known at compile time. This is the one mistake that
   turns a metrics endpoint into an outage. Per-guild questions belong to a dashboard endpoint (AMA already has
   one at `GET /v3/guilds/:guildId/ama/amas/:amaId/stats`), never here.
3. **Only declare a counter something actually writes.** A counter no code path increments is indistinguishable
   from a broken feature on a dashboard.

`discord_requests_total{bot,method,route,status}` is shared by all four, written by a single
`RESTEvents.Response` listener in `bot-core`'s `createBotRest`. `route` is @discordjs/rest's rate-limit _bucket_
route, which already has every snowflake replaced by `:id`, so it is bounded by endpoint count rather than guild
count. It counts Discord's _answers_: a connection-level failure throws before the event fires.

`discord_guilds{bot}` is the other shared name, written by `bot-core`'s `createBotClient`. It is a gauge of **one
replica's own shard slice**, refreshed by a single `SCARD` on the ten-second heartbeat that already re-arms the
guild list's TTL, so `sum by (job) (discord_guilds)` is the fleet total -- slices are disjoint by shard ownership
(see [12-horizontal-scaling.md](roadmap/12-horizontal-scaling.md)), so replicas never double-count each other. It
departs from the rules above twice, deliberately:

- **It is not zero-initialised.** Every counter here is, because one that never fired reads as "No data" rather
  than `0`. A replica that has not identified yet is in an _unknown_ number of guilds, not zero, and seeding `0`
  would make every rolling restart dip the fleet total for as long as an identify takes. Both READY _and_ RESUMED
  publish it the moment the slice is live -- a routine restart replays as RESUMED, not READY, on a registry that
  is empty again -- so the series always appears, including as a real `0` for a bot in no guilds.
- **The `bot` label carries the bare `BotId`,** so a custom ModMail instance's `MODMAIL#<slug>` guild-list key
  still reports as `MODMAIL`. Prometheus already separates those with the `modmail_instance` target label below;
  letting the slug into the metric too would split one bot into two names on top of that.

**Two AMA counters are defined in both `ama-bot` and `services/api`**, distinguished by `source="bot"` vs
`source="dashboard"`, because the dashboard is AMA's primary moderation surface -- a bot-only counter would read
as "moderation stopped" for any guild that triages on the web. Grafana sums across the two jobs. Keep the label
sets identical in both files or the sum silently splits.

**Ports** (`.env.public`, container-internal, never published): api `7004`, automoderator `7006`, ama `7007`,
modmail `7008`, social `7009`. Adding one means four files -- `env.ts` plus the three env stubs
(`backend-core`'s `env.test.ts`, `bot-core`'s `testEnv.ts`, `services/api`'s `stubEnv.ts`) -- and missing any of
them fails the whole test file at its import, since `envSchema.parse` runs at module load.

**Scraping scaled bots.** `ama-bot`, `modmail-bot` and `social-bot` run as N containers of _one_ compose service
(`./compose up` passes `--scale`). A static target would resolve to a different replica on each scrape, and every
hop reads as a counter reset -- so those jobs use `dns_sd_configs` with `type: A` against the compose service
name, which Docker's embedded DNS answers with one record per replica. `docker_sd_configs` was rejected: prod and
canary share a Docker socket, so prod's Prometheus would discover canary's containers as permanently-DOWN phantom
targets, and `prometheus.yml` has no env-var expansion to scope it with.

To confirm DNS is behaving (read-only):

```sh
./compose exec api node -e "require('dns').resolve4('ama-bot', (e, a) => console.log(e ?? a))"
```

`count(up{job="ama-bot"})` in Grafana should then equal what `./compose ps ama-bot` shows.

**Custom ModMail instances share the `modmail-bot` job**, as extra entries in its `names:` list, with a
`modmail_instance` target label relabelled from `__meta_dns_name` (the compose service name, which for these _is_
the `modmail_instances.id` slug). Partners are ModMail customers like anyone else, so `sum(...)` gives the fleet
total and `sum by (modmail_instance) (...)` gives the breakdown. A job per partner would have fragmented every
aggregate forever.

**Dashboards.** `ama-overview`, `modmail-overview`, `social-overview` and `automoderator-overview` sit alongside
`api-overview` and are picked up by the existing file provider -- no Grafana UI work. Each inherits the `$window` variable described
above, **defaulting to `6h` rather than `1h`**: bot feature counters are far lower-volume than API routes, so the
NaN trap bites harder here. They also use `increase()` rather than `rate()` ("3 tickets in 6h" is readable,
"0.000139/sec" is not).

`automoderator-overview` is the widest of the four, because AutoModerator is the widest product: rows for
moderation (cases filed versus Discord calls actually made -- deliberately two questions, since a WARN files a case
and makes no call while an observed manual ban makes none and files one), filters and native AutoMod intake,
the report queue, the scheduler, log webhooks and the message cache, then the Discord API. It is also the only bot
dashboard with a **Replicas** row: `automoderator_shards_owned` and `automoderator_replica_index` are per-process
by construction (`dns_sd` holds one target per container), so `sum(automoderator_shards_owned)` is the cluster's
shard coverage and a replica reading above `AUTOMODERATOR_SHARDS_PER_REPLICA` is covering for a missing peer.

`guilds-overview` is the one dashboard that spans every bot rather than covering one: a chart per bot off the
single `discord_guilds` name, which is what the shared name buys. Its `$window` is not a rate window (there is no
counter on it) -- it only sets what the "Net change" panel compares today against, so it defaults to `24h` and
goes out to `30d`.

One trap specific to these: **prom-client emits no series at all for a label combination until it is first
incremented**, so a counter that has legitimately never fired reads as "No data" rather than `0`, and
`sum(increase(...))` over it returns an empty vector that no `> 0` guard can rescue. Each `metrics.ts` therefore
**zero-initialises its closed label sets at startup**. Add a new label value and you must add it there too, or
its panel will be silently absent until the first real event.

Also as part of #277: the `postgres-overview` dashboard's "Top 20 Queries by Mean Execution Time" table dropped the
`datname`, `queryid`, and `user` columns (noise — `queryid` is redundant once `query` text is joined in, and this
deployment is single-database/single-user) via the same `fieldConfig.overrides`/`custom.hidden` mechanism already
used to hide `job`/`instance`.

### Frontend error reporting (#386)

`apps/website` reports errors to a self-hosted **GlitchTip** at `errors.automoderator.app` — one container on
the `monitoring` profile, sharing the Postgres instance. Rationale and the rejected alternatives are in
[ADR 0003](adr/0003-frontend-error-reporting.md); this is the operational half.

**Why `VALKEY_URL` is an empty string.** GlitchTip falls back to Postgres for its task queue and cache when it
has no Valkey. That is deliberate and must not be "tidied up" into `redis://redis:6379`: the shared Redis runs
with no `maxmemory` and holds `bot-core`'s replica leases, the per-replica guild lists and the message cache.
Adding a Celery broker to it is how a lease gets evicted and two replicas claim the same shard index.

**Why the role is excluded twice.** `glitchtip` gets the same two exclusions `chatsift_exporter` does, for the
same reason and via the same levers — `--collector.stat_statements.exclude_users` in `docker-compose.yml` and
`log_min_duration_statement = -1` in `build/postgres/init/03-glitchtip.sh`. `pg_stat_statements` is
cluster-wide with a fixed `max=5000` and `POSTGRES_SLOW_QUERY_LOG_MS` is deliberately 5ms, so Django's
statement churn would otherwise both crowd application queries out of that budget and bury them in the log.
The #270 tooling degrades quietly rather than loudly if this is missed.

#### One-time host steps

`docker-entrypoint-initdb.d` only runs against a **fresh** data directory, so on the existing prod/dev volume
the role and database must be created by hand. Run the mounted script itself rather than transcribing its SQL,
so the two can never drift — and pass the password on the `exec`, since the script reads it from the
environment and `docker exec` does not inherit the compose service's env:

```bash
./compose exec -e GLITCHTIP_DB_PASSWORD="$(grep '^GLITCHTIP_DB_PASSWORD=' .env.public | cut -d= -f2-)" \
  postgres bash /docker-entrypoint-initdb.d/03-glitchtip.sh
```

Then:

1. Add an `errors` A record for the host, and let Caddy issue the certificate.
2. `./compose up -d glitchtip`, then create the single account:
   `./compose exec glitchtip ./manage.py createsuperuser`. `ENABLE_USER_REGISTRATION` is `False` because the
   host is public — note this defaults to `True` upstream, so it is off only because we set it.

   **If that warns about unapplied migrations, stop and run `./compose exec glitchtip ./manage.py migrate`
   first** — creating a superuser against a schema that does not exist gets you a half-made account. Seeing
   that warning at all means `SERVER_ROLE: all_in_one` has gone missing from the service: it is what applies
   migrations at boot, and without it the container comes up as a plain web role that serves happily and
   never migrates. It cost us exactly that on the #386 cutover.

   **Then create the cache table**, which `migrate` does not:

   ```sh
   ./compose exec glitchtip ./manage.py createcachetable
   ```

   This is the second half of the `VALKEY_URL: ''` decision. With no Valkey, Django's cache backend is the
   database, and that backend needs a `django_cache` table created by its own management command. Nothing
   touches the cache until something does — allauth's login rate limiter is first, so the symptom is a 500 on
   `/_allauth/browser/v1/auth/login` reading `relation "django_cache" does not exist`, long after the install
   looked finished. Idempotent, so re-running it is free.

3. In the UI, create the organization and project. **Both slugs must match `next.config.mjs`'s `org` and
   `project`** (`chatsift` / `website`) or uploads 404 with nothing else to go on.
4. Copy the project **DSN** from the project's Settings — `https://<key>@errors.automoderator.app/<id>`.
   Check the host: it is rendered from `GLITCHTIP_DOMAIN`, so a `localhost` or container-name host there
   means that variable did not take and the browser would post events nowhere.

   Then mint the upload token at **Profile → Auth Tokens** (`/profile/auth-tokens`). Note these are
   **user-scoped, not organization-scoped** — GlitchTip differs from Sentry here. Scopes: `project:releases`
   (the one that matters — the plugin runs `sentry-cli releases new <sha>`), plus `project:read`, `org:read`
   and `event:read`. Shown once.

   That makes the single admin account a production build dependency: with `ENABLE_USER_REGISTRATION` off
   there is only one, and deleting it or rotating its token without updating Vercel fails the next
   production deploy via `errorHandler`.

5. **Create the project's error-rate alert**, which is the half of the alerting split GlitchTip owns and the
   only thing that tells you the dashboard is broken. In the project's Alerts, add a rule with a quantity and
   timespan threshold (start around 10 events in 5 minutes and tune once a week of real traffic exists), and
   add a **Discord webhook** recipient. Reuse the existing alerts webhook or make a dedicated one.

   Verify it end to end rather than assuming: trigger the threshold on purpose (the throwaway
   `?__error_test=1` style route, or simply a bad deploy on a preview pointed at the project) and confirm a
   message lands in Discord. An alert rule that was never fired once is indistinguishable from a missing one.

Grafana covers the other half — `glitchtip-absent` and `container-crashlooping` in `rules.yml` fire when
GlitchTip itself is gone, which its own alerting cannot do.

#### Vercel environment

The dashboard is not deployed from this repo, so both of these are set in the Vercel project, **Production
only** — previews then get no DSN, the SDK no-ops, and preview errors never pollute production fingerprints.

| Variable                    | Purpose                                                                |
| --------------------------- | ---------------------------------------------------------------------- |
| `NEXT_PUBLIC_GLITCHTIP_DSN` | Inlined into the client bundle; absent means the SDK never initialises |
| `SENTRY_AUTH_TOKEN`         | Gates `productionBrowserSourceMaps` **and** authenticates the upload   |

`SENTRY_AUTH_TOKEN` keeps the Sentry name even though the vendor is GlitchTip: the bundler plugin and
`glitchtip-cli` both default to it.

Both are declared in `apps/website/turbo.json` under **`env`**, not `passThroughEnv` — Turbo 2 runs strict env
mode and would otherwise drop them from the task silently. The token belongs in `env` despite being a secret,
and that is deliberate: `passThroughEnv` values do **not** contribute to the cache key, so a build produced
without the token would share a key with one produced with it. Since remote caching is enabled
(`TURBO_TOKEN`/`TURBO_TEAM` in `ci.yml`), that means a tokenless CI artifact could be replayed for a build that
was supposed to upload, and the maps would silently never reach GlitchTip. Turbo hashes the value rather than
storing it, so the trade is a hash of a high-entropy token in cache metadata against a wrong-artifact replay.

#### Verifying a source-map change

**Deletion runs even when the upload fails** — verified against an unreachable host, where the maps were gone
regardless. Left alone that is a silent trap: a broken upload would look identical to a working one from the
outside while shipping a release nobody can symbolicate. The `errorHandler` in `next.config.mjs` closes it by
rethrowing, so **a failed upload fails the build**, and a green production build is itself the evidence that
the maps landed. The cost is that a deploy now depends on GlitchTip being reachable; if it is down and
something must ship, clear `SENTRY_AUTH_TOKEN` in Vercel and redeploy.

So, after a deploy with the token set:

1. Confirm the build succeeded — with `errorHandler` in place that already means the upload landed.
2. Trigger a real production error and confirm the stack shows `.tsx` frames.
3. Only then confirm `/_next/static/chunks/<hash>.js.map` 404s.

There is no longer a dummy-token local shortcut: an unreachable host now fails the build by design (that is
`sentry-cli releases new` exiting 1, not a misconfiguration). To check the _output_ shape without uploading
anywhere, build with no token at all — `sourcemaps.disable` then suppresses generation, so the deployed shape
is the same zero-maps result by a different route:

```bash
yarn turbo run build --filter=@chatsift/website --force
find apps/website/.next/static -name '*.map' | wc -l           # expect 0
grep -rl 'sourceMappingURL' apps/website/.next/static | wc -l  # expect 0
```

Note a turbo **cache hit** replays the build and skips the upload entirely, which explains an upload-free build
log. It is safe only because `SENTRY_AUTH_TOKEN` is in `env` rather than `passThroughEnv`, so a build that
could upload never shares a cache key with one that could not — see the note under the env table above before
changing that.

If step 2 fails because GlitchTip rejects the plugin's artifact bundles, the fallback is
`sourcemaps.disable: true` plus an explicit `glitchtip-cli sourcemaps inject` / `upload` post-build step; it
reads the same `SENTRY_*` names, which is why they were chosen.

#### Alerting

Split on purpose. **GlitchTip's own project alerts** cover error rate (a quantity/timespan rule with a Discord
webhook recipient) — the semantics the deleted `elevated-error-log-rate` rule had, run by the system that
actually holds the data. **Grafana** covers GlitchTip being gone (`glitchtip-absent` in `rules.yml`), because
a crashed instance reports nothing and looks identical to a quiet week; `container-crashlooping` covers it
too. Frontend error alerting deliberately does not go through Grafana, which cannot see Vercel-side errors at
all.

## Parallel work with git worktrees

Several agents can work at once, each in its own `git worktree` under `.claude/worktrees/` (gitignored). A worktree
starts with only _tracked_ files, so on its own it cannot build — `.env.private`, `build/prometheus/metrics_secret`,
`.yarn/cache` and `.turbo/cache` are all gitignored. `scripts/worktree-bootstrap.sh` symlinks all four back to the
main checkout: the two secrets so a rotation is never stale in a forgotten copy, the two caches because they are
~2.5G that must not be duplicated per worktree (turbo's cache is content-addressed and path-independent, so a build
in one worktree warms every other). A `SessionStart` hook in `.claude/settings.json` runs it automatically; it is
idempotent and a no-op in the main checkout.

`node_modules` is deliberately **not** shared. Yarn's node-modules linker resolves workspace packages
(`@chatsift/db`, `@chatsift/core`, …) through symlinks in the root `node_modules`, so sharing that tree would make a
worktree build against the _main checkout's_ sources — precisely the cross-talk worktrees exist to prevent. Each
worktree runs its own `yarn install`, which the shared yarn cache reduces to a local copy rather than a download.

Creating one by hand (Claude Code's own worktree support does the equivalent):

```bash
git worktree add .claude/worktrees/<name> -b <branch>
cd .claude/worktrees/<name> && ./scripts/worktree-bootstrap.sh && yarn install
```

### What is shared, and what a worktree must not touch

The host has exactly one dev stack — one Postgres, one Redis, one compose project — and every worktree sees it
through the symlinked `.env.private`. Two guards keep a worktree from mutating it out from under the main checkout:

- **`./compose` refuses to run from a worktree.** `COMPOSE_PROJECT_NAME` is shared, so `./compose down -v` or a
  rebuild started in a worktree would act on the containers and volumes the main checkout is using. Set
  `CHATSIFT_ALLOW_WORKTREE_COMPOSE=1` to override, only when that is genuinely what you want.
- **Each worktree gets its own database.** Bootstrap writes a gitignored `.env.worktree` pointing `DATABASE_URL_DEV`
  at `chatsift_wt_<slug>`, and every root `dev:*`/`db:*`/`migrate:*` script now loads it ahead of
  `.env.private`/`.env.public` (dotenv-cli's first `-e` wins, and a missing file is skipped silently, so the main
  checkout is unaffected). Without it, `yarn db:migrate` on a feature branch would apply that branch's migrations to
  the single database every other checkout reads.

  The database is not created for you — `yarn db:migrate` failing loudly beats silently writing somewhere shared:

  ```bash
  docker exec -i <compose-project>-postgres-1 createdb -U chatsift chatsift_wt_<slug>
  yarn db:migrate
  ```

Redis, the dev ports (`3000`, `3001`, `7004`–`7010`) and the Discord bot tokens stay shared and unguarded. Two dev servers or
two bots running at once will collide — but per the [verification standard](#verification-standard) that is the
operator's lane, and an agent's job in a worktree (`yarn build`, `lint`, `test`) touches none of them.

## Deploying

Two deployments run on the one VPS, from one codebase:

| Channel | Branch   | Checkout                     | `COMPOSE_PROJECT_NAME` | `RESOURCE_PREFIX` | `COMPOSE_PROFILES`          |
| ------- | -------- | ---------------------------- | ---------------------- | ----------------- | --------------------------- |
| prod    | `main`   | `/home/deploys/repos/prod`   | `chatsift-prod`        | `chatsift-v3`     | `monitoring,ingress,backup` |
| canary  | `canary` | `/home/deploys/repos/canary` | `chatsift-canary`      | `chatsift-canary` | (empty)                     |

`RESOURCE_PREFIX` still reads `chatsift-v3` on prod, and the volumes are still named `chatsift-v3-*`, even though
nothing else is called that any more. That is not leftover cruft — see the note below the table.

**Both branches ship a byte-identical `docker-compose.yml` and `.env.public`.** Everything that differs between the
two deployments lives in the host-local, gitignored `.env.private` (see `.env.private.example`). That is deliberate:
the retired `prod` branch carried its own trimmed `docker-compose.yml`, which is why it had to be labelled "do not
merge into `main`" and why it eventually drifted in code as well as config. With zero tracked divergence,
promoting `canary` → `main` is an ordinary merge.

Note `COMPOSE_PROJECT_NAME` and `RESOURCE_PREFIX` differ on prod, and must not be collapsed into one value — see
[Encryption at rest](#encryption-at-rest-263) and the comment above `volumes:` in `docker-compose.yml`.

### The pipeline

`.github/workflows/ci.yml`, on a push to `main` or `canary`:

1. **quality** -- `yarn build`/`lint`/`format:check`/`test`.
2. **build-push** -- builds the root `Dockerfile` once and pushes `ghcr.io/chatsift/chatsift:<channel>-<sha>`, then
   `turbo run tag-docker --filter '...[<base>...HEAD]'` aliases it to the moving `<channel>-<service>` tags that
   compose tracks -- only for services whose own code or workspace dependencies changed. Unchanged bots keep their
   old digest and are therefore not restarted by step 3.
3. **deploy** -- SSHes to the box and runs the deploy script below. It runs on every push, including ones that
   skipped the image build, because `docker-compose.yml`, `.env.public` and `build/` are read from the host
   checkout rather than baked into an image.

Three things about the aliasing in step 2 are worth knowing before you trust it:

- The filter selects **packages**, so a change confined to a root file that feeds every image would otherwise
  select nothing, push an image, and never point an alias at it. The workflow detects that case and re-aliases
  every service. That list of root files is the `ROOT_IMAGE_INPUTS` job env var, shared with the skip gate below
  so the two can never disagree. `docker-compose.yml` is deliberately excluded -- it is read from the checkout at
  deploy time, not baked into the image, so a compose-only change needs no new image at all.
- **`workflow_dispatch` rebuilds and re-aliases everything** on whichever branch you dispatch from. That is the
  escape hatch when the detection above is wrong, or when you want every service on one known digest. It replaces
  the old `deploy-manual.yml`.
- **The range is the whole push, not its tip commit.** Both the skip gate and the alias filter diff
  `github.event.before..HEAD`, which is why `build-push` checks out with `fetch-depth: 0` (the repo is ~12MB, so
  full history costs a second). Diffing `HEAD~1..HEAD` instead would let a multi-commit push whose last commit is
  docs-only skip a build the earlier commits needed, while `deploy` still ran against the stale digest. When the
  range cannot be resolved -- a manual dispatch, a branch's first push, a force-pushed base that no longer exists
  -- everything is rebuilt and re-aliased, so the failure mode is a wasted build rather than a missed one.

#### Why build-push has no Docker layer cache (#387)

Step 2 skips itself entirely when the pushed range touches nothing under `packages/`, `services/` or
`ROOT_IMAGE_INPUTS` -- `apps/website` is not in the image at all (the `Dockerfile` never copies `apps/`; the
dashboard deploys off-repo), and docs, Grafana/Prometheus provisioning and compose config are read from the host
checkout. That was 15 of the 60 pushes to `main` before the gate landed, each paying ~2 minutes to rebuild and
push a byte-identical image. `build/caddy/` is gated separately, since the ingress image is independent.

It also passes no `cache-from`/`cache-to` to `docker/build-push-action`, which is deliberate and worth not
"fixing" back:

- Measured on real runs, `cache-to: type=gha,mode=max` cost **50s on a warm build and 82s on a cold one** -- more
  than half the step -- while the only layers `cache-from` ever restored were `WORKDIR` and the `apk add` line,
  worth ~11s.
- It was also **10.25 GB of the repo's 10 GB Actions cache budget** (549 entries, 96% `buildkit-blob-*`). Over the
  limit, GitHub evicts least-recently-used entries, so the export was steadily evicting the very layers it existed
  to serve -- which is why `COPY .yarn` and `yarn workspaces focus` re-ran on every build even when their inputs
  were byte-identical to the previous one.
- Nothing expensive is left uncached anyway: `turbo run build` inside the image is a remote-cache hit (~2.5s, see
  the `.gitattributes` note in the `Dockerfile`), and the install is ~10s because `COPY .yarn ./.yarn` brings in
  the Yarn download cache that the job's own `Install dependencies` step just restored. **Do not add `.yarn/cache`
  to `.dockerignore`** -- that link is what makes the in-image install offline.

The ingress image keeps its cache: `xcaddy build` compiles Caddy from source, and that step only runs on the rare
commit touching `build/caddy/`.

The GHCR package is **private**. CI authenticates with the built-in `GITHUB_TOKEN`; the VPS needs a separate
read-only credential (`read:packages` and nothing else), applied once as the `deploys` user:

```sh
printf '%s' '<token>' | docker login ghcr.io -u '<machine-account>' --password-stdin
```

A silently-expired token turns every subsequent deploy into a pull failure, so prefer one that does not expire.

### Rolling back

Every build leaves an immutable `<channel>-<sha>` tag. To roll a single service back, re-point its moving alias and
re-run the deploy:

```sh
docker buildx imagetools create -t ghcr.io/chatsift/chatsift:main-ama \
  ghcr.io/chatsift/chatsift:main-<known-good-sha>
```

### `/home/deploys/bin/deploy` (host-side, not in this repo)

It lives on the host rather than in the checkout on purpose: it must be able to deploy a commit older than any
change to itself, and it must keep working when a bad commit is what you are backing out of.

```bash
#!/bin/bash
set -euo pipefail

# The SSH key is registered with a forced command, so $SSH_ORIGINAL_COMMAND is the only thing the
# caller controls. Validate it against a literal allowlist rather than interpolating it into a path.
case "${SSH_ORIGINAL_COMMAND:-}" in
  main)   BRANCH=main;   REPO=/home/deploys/repos/prod ;;
  canary) BRANCH=canary; REPO=/home/deploys/repos/canary ;;
  *) echo "refusing to deploy unknown channel: ${SSH_ORIGINAL_COMMAND:-<empty>}" >&2; exit 1 ;;
esac

# Lock in the deploys home rather than /var/lock -- that directory's ownership and mode vary by
# distro, and this runs unprivileged.
exec 9>"/home/deploys/.deploy-${BRANCH}.lock"
flock -n 9 || { echo "a ${BRANCH} deploy is already running" >&2; exit 1; }

cd "$REPO"
git fetch --prune origin "$BRANCH"
git reset --hard "origin/${BRANCH}"

./compose pull
./compose up -d
docker image prune -f
```

Note `./compose up -d` injects `--wait --wait-timeout 300` of its own (#294), so this blocks until every
container with a healthcheck reports healthy and a deploy that comes up broken exits non-zero here rather than
reporting green. That lives in `./compose` rather than in this script precisely because this script is versioned
nowhere. Three things narrow it: it only fires for a **detached** `up` (`--wait` implies `--detach`, so an
attached `./compose up` would stop streaming logs), it stands aside if you pass `--wait`/`--wait-timeout`
yourself, and `CHATSIFT_NO_WAIT=1` skips it for restarting one service mid-incident without blocking on the rest.

The 300s is coupled to the bots' `start_period` and to Discord's identify throttle (one shard per 5s per bucket).
A large enough shard fleet can push the last replica's first heartbeat past it and fail an otherwise-healthy
deploy, so raise it alongside `<BOT>_SHARDS_PER_REPLICA` rather than on its own.

Register the key so it can run nothing else:

```
command="/home/deploys/bin/deploy",no-pty,no-agent-forwarding,no-port-forwarding,no-X11-forwarding ssh-ed25519 AAAA…
```

CI needs `DEPLOY_SSH_KEY`, `DEPLOY_HOST` and `DEPLOY_KNOWN_HOSTS` as repository secrets. The host key is pinned;
do not reach for `StrictHostKeyChecking=no`.

### What "healthy" means

Every app container has a healthcheck as of #294. `api` answers `/health` on `${API_PORT}`; each bot answers it
on its own metrics port (7006-7010), unauthenticated, alongside the bearer-gated `/metrics`.

A bot's verdict comes from the gateway heartbeat, not from the process being alive:

| `state`    | HTTP | Meaning                                                                        |
| ---------- | ---- | ------------------------------------------------------------------------------ |
| `healthy`  | 200  | Every shard this replica owns ACKed a heartbeat within 135s (~3 missed beats). |
| `spare`    | 200  | Parked waiting for a replica index. Healthy: waiting is the job.               |
| `starting` | 503  | The replica claim has not resolved, so it does not yet know which it is.       |
| `stalled`  | 503  | An owned shard has not ACKed in 135s, or has never ACKed at all.               |

`start_period` is 180s for bots, because a shard has no heartbeat to report until it has identified and identify
is throttled fleet-wide. It is a grace period for _failures_ only -- docker promotes a container to healthy on its
first passing check even inside it, which is why `starting` is a 503 rather than an optimistic 200. Docker does **not** restart an unhealthy container -- only Swarm does -- so a healthcheck
here buys `depends_on` gating, the `--wait` deploy gate above, and a legible `docker compose ps`, not self-healing.

The history behind the verdict is in Grafana's **Gateway Health** dashboard
(`build/grafana/dashboards/gateway-overview.json`), off `discord_shard_heartbeat_latency_seconds` and
`discord_shard_last_ack_seconds`.

### Applying a migration

Automatic, as of #294. The `migrate` service runs `atlas migrate apply` out of the deployed image against the
migration directory baked into it, and every service that touches the database is gated on it finishing:

```yaml
depends_on:
  migrate:
    condition: service_completed_successfully
```

So `./compose up -d` cannot start code against an unmigrated schema, and a migration that fails takes the deploy
down with it rather than letting the containers start anyway. Most deploys are a no-op -- atlas reads its own
`atlas_schema_revisions` table and prints `No migration files to execute`.

Three consequences worth having read before you write one:

- **Nobody approves it any more.** The gate moved to review time: CI's `migrations` job lints what a PR adds and
  fails on a destructive change (`DS103` and friends). That job is the only thing now standing between a
  `DROP COLUMN` and production.
- **`migrate` runs while the old containers are still up**, so for a few seconds the running code is a version
  behind the schema. That is inherent to applying migrations at deploy time, and the rule it implies is expand
  and contract: add nullable, backfill, switch the code, drop in a _later_ deploy. A migration that is destructive
  in the same deploy as the code change will break the old containers during the swap.
- **Rolling an image back does not roll a migration back.** Re-pointing an alias undoes code, not schema.
  `atlas migrate down` stays manual and stays an incident.

To apply one by hand anyway -- a backfill you want to watch, or recovering from a failed `migrate` -- go through
the container so it is the same atlas and the same directory the deploy would use:

```sh
./compose run --rm migrate
```

The host-shell `yarn db:migrate` still works from the checkout and still targets the same database (`atlas.hcl`
resolves `DATABASE_URL_DEV`, which reaches postgres through the host-published `LOCAL_DATABASE_PORT` rather than
the in-network `postgres` hostname). It needs `node_modules` and a host atlas install, neither of which the box
needs for anything else any more.

`IS_PRODUCTION` does nothing for either path: `atlas.hcl` resolves `getenv("DATABASE_URL_DEV")` unconditionally,
and the `IS_PRODUCTION ? _PROD : _DEV` switch lives in Node (`createDatabase`, and `migrationCommon.ts`). The
`migrate:legacy-*` scripts are the opposite case -- those are Node, they do branch on it, and their runbooks mean
it.

### Renaming a compose project

If `COMPOSE_PROJECT_NAME` ever changes for an existing deployment, run `./compose down` **before** pulling the
change. Otherwise compose loses track of the running containers and the next `up -d` starts a second full set —
including a second Postgres against the same volume.

### Ingress (#305)

Caddy terminates TLS for every `*.automoderator.app` subdomain and lives in this repo as of #305 — it used to be
its own `ChatSift/caddy` repo and its own compose project on the same box. Routes are
[`build/caddy/Caddyfile`](../build/caddy/Caddyfile), the image is `build/caddy/Dockerfile`.

| Host                             | Upstream                                 |
| -------------------------------- | ---------------------------------------- |
| `api.automoderator.app`          | `api:${API_PORT}`                        |
| `grafana.automoderator.app`      | `grafana:3000`                           |
| `dozzle.automoderator.app`       | `dozzle:8080`                            |
| `interactions.automoderator.app` | legacy `automoderator-interactions:3002` |
| `logs.automoderator.app`         | legacy `parseable:8000`                  |

Three things about it are load-bearing:

- **It is behind the `ingress` profile.** Only one deployment on the host can bind `:80`/`:443`, and that is prod.
  Canary leaves `COMPOSE_PROFILES` empty and is therefore not publicly routed at all — it never was.
- **It joins a second, external network, `chatsift`.** That is the _legacy_ `ChatSift/stack` project's network, and
  it is the only way to reach `automoderator-interactions` and `parseable`, which publish to `127.0.0.1` only. The
  cost is that `caddy` will not start if that network is gone. Both routes and the `legacy` network entry get
  deleted together when the legacy stack is torn down at
  [AutoModerator P9](roadmap/11-automoderator-port.md).
- **Its volumes are `external` and un-prefixed** (`chatsift-caddy-data`, `chatsift-caddy-config`) rather than named
  from `RESOURCE_PREFIX` like every other volume here. They are the ones the old deployment already wrote to, so
  adopting them by name carries the ACME account and the issued certificates across unchanged. On a host that never
  ran the old stack, `docker volume create chatsift-caddy-data` (and `-config`) once before first boot.

Because Caddy is on the compose network, `api`, `grafana` and `dozzle` publish **nothing** to the host — the
`LOCAL_API_PORT`/`LOCAL_GRAFANA_PORT`/`LOCAL_DOZZLE_PORT` knobs are gone. Only Postgres and Redis still publish,
for the host-shell workflows above (`yarn db:migrate`, `redis-cli`). To reach the API from the host during an
incident, go through a container already on the network:

```sh
./compose exec api wget -qO- http://127.0.0.1:7004/<route>
```

`CF_API_TOKEN` in `.env.private` is the Cloudflare token Caddy uses for the ACME DNS-01 challenge; it needs
`Zone:DNS:Edit` on the zone and nothing else. Only the deployment running the `ingress` profile needs it set.

**Changing a route** is an ordinary commit: CI rebuilds the ingress image only when `build/caddy/` itself changed
(pushing the moving `<channel>-caddy` tag on every commit would recreate the container terminating TLS for every
domain on every deploy), and the host-side `./compose pull && ./compose up -d` picks it up. Immutable
`<channel>-caddy-<sha>` tags are pushed alongside for the same rollback story as the service images.

## `unban.app` (#232 P3)

The appellant-facing app is `apps/appeals`, and it is the second Next app on the `@chatsift/web-core` substrate. It
is a **separate Discord application and a separate eTLD+1** from the dashboard on purpose (decision 3): a banned
user is never asked to authorize something branded for a product they have no relationship with.

### Running it locally

```sh
yarn workspace @chatsift/appeals dev   # http://localhost:3001, matching APPEALS_FRONTEND_URL_DEV
```

It needs `yarn dev:api` running alongside it, and nothing else -- no bot, no gateway. The Appeals bot only
matters once a guild is being configured or an appeal is being posted; the appellant-facing routes reach Discord
through the API's own Appeals REST client.

The two sessions are meant to be mutually unreachable, and that is worth exercising rather than trusting: sign in
on `localhost:3001`, confirm `localhost:3000`'s dashboard session is untouched, and confirm each app's cookie is
rejected by the other's routes. `services/api/src/middleware/__tests__/isAppealsAuthed.test.ts` covers both
crossings at the unit level; the browser half is the operator's.

### One-time setup per environment

Dev and prod run two _different_ Appeals applications, which is why `APPEALS_OAUTH_CLIENT_ID` lives in the
per-host `.env.private` rather than in `.env.public` alongside the dashboard's.

1. On the Appeals application's OAuth2 page, add a redirect URI of `<API_URL>/v3/appeals/auth/discord/callback`
   -- `http://localhost:7004/...` for dev, `https://api.automoderator.app/...` for prod. Discord rejects the
   authorize request outright if it does not match, byte for byte.
2. Fill in `APPEALS_OAUTH_CLIENT_ID` and `APPEALS_OAUTH_CLIENT_SECRET` in `.env.private`.
3. For prod only: a Vercel project for `apps/appeals` pointed at `unban.app`, with
   `NEXT_PUBLIC_API_URL=https://api.automoderator.app` and `NEXT_PUBLIC_WEBSITE_URL=https://automoderator.app`.
   The second is what the shared footer and the header's Support link hang off -- `unban.app` has no `/terms`,
   `/privacy`, `/github` or `/support` route of its own. It falls back to production if unset, so a missing var
   is a silent no-op in prod and a wrong link locally, rather than a broken build.

**The consent screen is worth reading once, and it is the thing to check if decisions stop being deliverable.**
The authorize URL sends `integration_type=1` (a _user_ install), which is what turns `applications.commands` into
permission to DM the appellant with no shared guild -- the only mechanism there is, since no OAuth scope grants
DM permission (§6 of the roadmap doc). A correct screen shows "Send you direct messages" as its own line. If it
does not, the flow still completes and the failure surfaces weeks later, as an approved appeal nobody can be
told about.

## Custom ModMail instances (#216)

Branded, single-guild ModMail deployments for approved close partners — see
[roadmap/01-architecture.md §8](roadmap/01-architecture.md#8-custom-modmail-instances-216) for the full design. Hand-managed
by design: there is no dashboard/API provisioning flow, since a `modmail_instances` row
holds a live bot token. The steps below are things only an operator with direct Postgres/compose access runs —
not something an agent should do on your behalf.

**Where leads come from:** every ModMail dashboard offers its managers a one-way "we're interested" button, and
`/admin` lists every guild that has pressed it — who pressed, which server, and when. That list is the only
automated part of this; everything below is still manual.

### Onboarding a partner

Order matters — do these in sequence, not in parallel:

1. **Insert the registry row first**, before starting anything. `modmail_instances.token` must be the partner's bot
   token encrypted with `ENCRYPTION_KEY`, in the exact AES-256-GCM `base64([iv | ciphertext | authTag])` shape
   `packages/private/backend-core`'s `encrypt`/`decrypt` (`lib/crypt.ts`) use — those functions themselves read
   `ENCRYPTION_KEY` off a fully-initialized app context (`getContext()`), so they aren't a bare one-liner import;
   the snippet below reimplements the same shape standalone instead (verified round-trips correctly against the
   real `decrypt()` during P6's own smoke test):

   ```sh
   npx dotenv -e .env.private -e .env.public -- node -e "
     const crypto = require('crypto');
     const IV_LENGTH = 12;
     const key = Buffer.from(process.env.ENCRYPTION_KEY, 'base64');
     const iv = crypto.randomBytes(IV_LENGTH);
     const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
     const ciphertext = Buffer.concat([cipher.update(process.argv[1], 'utf8'), cipher.final()]);
     console.log(Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString('base64'));
   " '<the partner bot token>'
   ```

   Then insert the row with the encrypted value (pick a stable, lowercase `id` slug — this is what the deployment's
   `MODMAIL_INSTANCE_ID` must match, and renaming it later means redeploying). psql's `:'var'` substitution doesn't
   interpolate through `-c` reliably in every setup — writing the insert to a small `.sql` file and running it with
   `-v`/`-f` is the more reliable route:

   ```sh
   printf "INSERT INTO modmail_instances (id, guild_id, token, label) VALUES ('<partner-slug>', '<guild id>', :'enc', '<display label>');\n" > /tmp/insert_instance.sql
   ./compose exec -T postgres psql -U chatsift -d chatsift -v enc='<encrypted token from above>' -f - < /tmp/insert_instance.sql
   ```

   (`-T` disables the pseudo-tty compose would otherwise allocate, which is what lets the `<` redirect actually
   reach `psql`'s stdin through `docker compose exec`.)

2. **Wait up to 60s** (the registry's refresh interval, `packages/private/backend-core/src/lib/instances.ts`) —
   the public `modmail-bot`/`api` processes pick up the new row and stop acting on that guild without a restart.
   Confirm before moving on: the public bot should now answer that guild's leftover commands/panel with "this
   server is served by `<label>`" instead of doing anything.
3. **Start the partner's deployment.** Copy the commented-out `modmail-bot-<partner-slug>` template block in
   `docker-compose.yml` (right after the public `modmail-bot` service), fill in `<partner-slug>` throughout
   (service name, `MODMAIL_INSTANCE_ID`, log volume), uncomment it, then `./compose up -d modmail-bot-<partner-slug>`.
   It fails fast on boot if `MODMAIL_INSTANCE_ID` doesn't match a row (see `loadInstances()`'s doc comment).
4. **Run both Resyncs** for that guild in the dashboard — the button on the ModMail **Snippets** page
   (`services/api/src/routes/modmail/snippets/resyncSnippets.ts`) and the one on the ModMail **Panels** page
   (`services/api/src/routes/modmail/panels/resyncPanels.ts`); both are visible now that the guild has a custom
   instance. They're two separate buttons since #331 — snippets registers every existing snippet as a guild command
   under the partner's application, panels reposts every panel message. Both are needed here, since both kinds of
   object were created under the public application and Discord scopes commands/message-authorship to the
   application that created them.
5. **Add them to Prometheus.** Append `modmail-bot-<partner-slug>` to the `names:` list of the `modmail-bot` job
   in `build/prometheus/prometheus.yml`, then `./compose kill -s HUP prometheus` (SIGHUP re-reads the bind-mounted
   config; no restart needed). They share the job rather than getting their own, and the `modmail_instance` target
   label separates them — see § Metrics. Forgetting this is benign: the bot runs, you just have no metrics for it.
6. Verify: `/snippet` commands work and the panel button opens a ticket, both through the partner's bot presence.

#### Onboarding a partner who has legacy ModMail history

The steps above assume a guild with no prior history, which was true of every partner onboarded in 2026-07. A
partner self-hosting legacy `ChatSift/ModMail` (their own copy, their own Postgres) needs their data migrated
first — see the NASCAR pilot in
[roadmap/06-modmail-port.md](roadmap/06-modmail-port.md#the-nascar-pilot) for the full sequence. Three deltas to
the runbook above:

- **Migrate before inserting the registry row**, not after. `migrateLegacyModmail.ts`'s preflight warns when a
  legacy guild already has a `modmail_instances` row — harmless in this case, but it's a warning worth keeping
  meaningful for the public cutover.
- **Pass `--source <partner-slug>`** to the migration, matching the instance slug. This is what keeps one
  partner's migration from blocking or miscounting the public one later.
- **Step 4's Snippets resync is mandatory, not optional** — migrated `snippets.command_id` values belong to the
  partner's _legacy_ application and 404 under their new one. The Panels resync is a no-op for a migrated guild
  (legacy had no panels), but pressing it costs nothing. Their admin must also pick a Forum on the dashboard
  before anything works: `mod_forum_id` is deliberately migrated as `NULL`.

### Offboarding a partner (moving a guild back to the public deployment)

Reverse order — resync while the row (and therefore the partner's token) is still reachable, _then_ tear down:

1. **Run both Resyncs first** (Snippets page, then Panels page), while the `modmail_instances` row still exists.
   Deleting the row before this loses the ability to reach the partner's application at all for cleanup, and —
   more importantly — resync always targets whichever application the registry says currently owns the guild, so
   it must run before the row disappears for a swap in this direction to have anything to reconcile _from_.

   Note this asymmetry with onboarding: resync targets the _new_ owner, and during offboarding the new owner
   (public) only becomes current once the row is gone. So this step actually happens in two parts — run both
   buttons with the row still present to let the partner's application clean up what it can reach, then delete the
   row (step 3 below), then run both again now that the guild resolves to the public application, to
   recreate/repost everything under it. Four button presses total, two per page.

2. **Stop the partner's deployment** (`./compose stop modmail-bot-<partner-slug>`, then remove or re-comment its
   `docker-compose.yml` block).
3. **Delete the registry row** (`DELETE FROM modmail_instances WHERE id = '<partner-slug>'`). The public bot
   resumes ownership within 60s of this.
4. **Run both Resyncs again** for the same guild, now that it resolves to the public deployment, to finish
   reconciling snippets (Snippets page) and panels (Panels page) onto it.
5. **Remove them from Prometheus** — drop `modmail-bot-<partner-slug>` from the `modmail-bot` job's `names:` list
   and `./compose kill -s HUP prometheus`. Forgetting this leaves a DNS resolution error every 30s and a
   permanently absent target: noise, not breakage.
6. Verify the same golden path as onboarding, this time through the public bot.

## Scaling a bot across replicas

Design and rationale: [docs/roadmap/12-horizontal-scaling.md](roadmap/12-horizontal-scaling.md). This is the
operational half.

**Nothing is needed until Discord recommends more than one shard for a bot.** Below that, leaving
`<BOT>_SHARDS_PER_REPLICA` blank is correct — the bot already runs one replica holding every shard, through the
same code path a scaled one uses.

### Turning it on

1. Check what Discord actually recommends. There is no point sharding ahead of it:

   ```bash
   curl -s -H "Authorization: Bot $TOKEN" https://discord.com/api/v10/gateway/bot | grep -o '"shards":[0-9]*'
   ```

2. Set `<BOT>_SHARDS_PER_REPLICA` in `.env.public` (`AMA_`, `MODMAIL_`, `SOCIAL_`). This is the only number to
   choose: how many shards one replica should carry. Replica count is derived from it.
3. `./compose up -d`. It reads `/gateway/bot` itself, prints the arithmetic
   (`ama-bot: 14 shard(s) / 4 per replica -> 4 replica(s)`) and passes `--scale`.
4. Confirm each replica claimed a distinct index:

   ```bash
   ./compose logs ama-bot | grep 'claimed replica slot'
   ```

   Every replica should appear once, with disjoint `shardIds` whose union is the full shard range.

### Changing the number later

Re-run `./compose up -d`. Discord's recommendation is re-read every time, so a shard-count bump is picked up at
the next deploy without anyone editing a number. Between the bump and that deploy the cluster is
under-provisioned, not broken — a replica absorbs the uncovered shards and logs `covering for missing replicas`.

### Turning it off

Blank the value and `./compose up -d`. Compose scales the service back to one; the survivor's watcher notices the
freed indices and restarts once to take them over.

### Things worth knowing

- **Replicas are cattle.** They share one image and one env block; which shards each runs is claimed at boot, not
  configured. Never hand-pin a replica to a shard range.
- **Restarting a replica is cheap and is the intended way to change its shard set** — sessions are stored in redis
  and resumed, so a bounce replays a gap rather than re-identifying.
- **Start replicas together.** A replica joining long after the others idles as a hot spare rather than
  rebalancing (`no free replica index` in the logs). `./compose up` does the right thing; starting one by hand
  later does not.
- **Log files gain a per-container suffix** (`2026-08-13.<container-id>.log`) once a bot is scaled, because all
  replicas bind-mount the same host directory. Unscaled bots keep the plain `<date>.log` name. Dozzle is
  unaffected either way — it reads stdout, which is per-container regardless.
- **Custom ModMail instances (#216) are never scaled.** They are single-guild by definition, so one shard, one
  replica. `./compose` only sizes the public deployments.

## Encryption at rest (#263)

Discord's Developer Terms of Service §5(c) ("Implement Good Security") lists "encryption of the data at rest" as a
required safeguard for API Data. Nearly everything in Postgres (Discord IDs, AMA question content, ModMail
transcripts, snippet content, guild settings — only `modmail_instances.token` is already application-level
encrypted, see the custom-instances section above) sits in plaintext on the host's disk today. Redis needs no
equivalent treatment: nothing in the stack treats it as a source of truth (`GuildList`/instance snapshots
republish on an interval, `PendingTicketStore` mirrors the durable `pending_tickets` table, grant-token claims are
best-effort), so `docker-compose.yml`'s `redis` service instead runs with RDB/AOF disabled
(`--save '' --appendonly no`) — fully in-memory, nothing on disk to encrypt in the first place.

For Postgres, the chosen approach is **native ext4 directory encryption (`fscrypt`)** on the existing disk, not a
separate LUKS-encrypted volume — fewer moving parts (no new block device to provision/attach/bill for, no loop
files, no `crypttab`), and the underlying crypto (AES-256-XTS via the kernel's AES-NI-accelerated path) is the same
either way. Confirmed viable on the production host: `df -T /` reports `ext4`, and `/proc/cpuinfo` has the `aes`
flag (plus `pclmulqdq`) — so this is expected to be a performance non-event (low single-digit percent at most on
sustained write-heavy I/O, no measurable memory or storage overhead; content encryption is block-for-block, no
size inflation).

**This is an operator runbook, not something an agent should do on your behalf** — it needs root on the production
host, a maintenance window, and judgment calls (backup verification, reboot testing) that shouldn't be automated
blind.

> **Status: done, live on the production host as of 2026-08-05.** The steps below are what was actually run,
> corrected in place for two `fscrypt` CLI mistakes discovered live (see the callouts on steps 4 and 6 — `encrypt`
> takes `--key=FILE`, not `--key-file=FILE`, and `unlock` doesn't accept `--source` at all, only `encrypt` does).
> The happy-path reboot test (step 7) was run for real and passed. The failure-path half of step 7 was
> deliberately **not** run against production — this host also runs real, currently-serving workloads unrelated to
> ChatSift, and deliberately breaking the boot sequence to prove a negative wasn't worth that risk once the
> mechanism (`docker.service`'s `Requires=` on the unlock unit) was understood and the happy path confirmed
> working. If this is ever re-run on a different host, the failure-path test is still worth doing there.

1. **Enable the ext4 encryption feature** (online, doesn't require unmounting `/`). Resolve the actual backing
   device rather than assuming `/dev/sda1` — that's `df -T /`'s current output on the production host, but isn't
   guaranteed to stay the device Docker's data lives on (a future attached volume, a differently-partitioned
   replacement host, etc.):
   ```sh
   docker_device="$(findmnt -no SOURCE /var/lib/docker)"
   [ "$(findmnt -no FSTYPE /var/lib/docker)" = ext4 ] || { echo "not ext4, stop here"; exit 1; }
   sudo tune2fs -O encrypt "$docker_device"
   ```
2. **Install and initialize fscrypt** (one-time, `apt install fscrypt` on recent Debian/Ubuntu; build from
   [google/fscrypt](https://github.com/google/fscrypt) if unpackaged):
   ```sh
   sudo apt install fscrypt
   sudo fscrypt setup
   ```
3. **Stop Postgres and set the data directory aside** — `fscrypt encrypt` requires an empty target directory:
   ```sh
   ./compose stop postgres
   sudo mv /var/lib/docker/volumes/chatsift-v3-postgres-data/_data /var/lib/docker/volumes/chatsift-v3-postgres-data/_data.bak
   sudo mkdir /var/lib/docker/volumes/chatsift-v3-postgres-data/_data
   ```
4. **Generate the unlock key and encrypt the directory.** A raw keyfile (not a passphrase protector) is what lets
   this unlock unattended at boot — treat it like `ENCRYPTION_KEY`: back it up offline (e.g. a password manager),
   since losing it makes the encrypted directory permanently unrecoverable, independent of normal DB backups.
   ```sh
   sudo sh -c 'head -c 32 /dev/urandom > /etc/fscrypt-postgres.key && chmod 600 /etc/fscrypt-postgres.key'
   sudo fscrypt encrypt /var/lib/docker/volumes/chatsift-v3-postgres-data/_data \
     --source=raw_key --key=/etc/fscrypt-postgres.key --name=postgres-data
   ```
   The flag is `--key=FILE`, not `--key-file=FILE` (`fscrypt encrypt --help` is the source of truth if this drifts
   again — the CLI doesn't do fuzzy matching, an unrecognized flag just dumps usage and exits 1). `--name` avoids
   an interactive prompt for the protector's name. The directory is unlocked for the current session immediately
   after `encrypt` runs, so it's writable right away.
   Copy `/etc/fscrypt-postgres.key`'s contents off the host now, before going any further — it's the only thing
   standing between an intact backup and permanently unrecoverable data, same as `ENCRYPTION_KEY`. It's raw binary,
   not text, so base64-encode it for safe storage (`base64 -w0 /etc/fscrypt-postgres.key` on Linux, `base64 -b 0
-i` on macOS) into a password manager as a Secure Note, and include the exact restore command
   (`base64 -d > /etc/fscrypt-postgres.key && chmod 600 /etc/fscrypt-postgres.key`) in the note body rather than
   just the key on its own. Clean up every plaintext copy made along the way (scp'd-down files, temp copies used to
   get it off the host) once it's safely stored — a copy sitting in a home directory defeats the same purpose the
   `_data.bak` wipe below protects.
5. **Copy the data back in and verify**, then bring Postgres back up:
   ```sh
   sudo rsync -a --info=progress2 /var/lib/docker/volumes/chatsift-v3-postgres-data/_data.bak/ \
     /var/lib/docker/volumes/chatsift-v3-postgres-data/_data/
   ./compose up -d postgres
   ./compose logs postgres  # confirm a clean start, no corruption/recovery errors
   ```
   Once the API and bots are confirmed healthy against it, **securely wipe `_data.bak`**, not just `rm -rf` it —
   a plain delete leaves the plaintext data recoverable from the underlying disk blocks, which defeats the entire
   point of encrypting `_data` in the first place:
   ```sh
   sudo find /var/lib/docker/volumes/chatsift-v3-postgres-data/_data.bak -type f -exec shred -u {} +
   sudo rm -rf /var/lib/docker/volumes/chatsift-v3-postgres-data/_data.bak
   ```
   (`shred` only guarantees overwrite on a filesystem without copy-on-write/journaling quirks that can leave
   stale copies elsewhere on disk — if this ever runs on anything other than plain ext4, treat the whole disk as
   needing attention, not just this one directory.)
6. **Auto-unlock at boot** — the directory relocks on every reboot until something unlocks it again, and that has
   to happen before Docker starts the `postgres` container. A oneshot systemd unit ahead of `docker.service`
   (there's no separate systemd unit for the compose stack itself — Docker's own `restart: unless-stopped` per
   service is what brings containers back after `docker.service` starts):

   ```ini
   # /etc/systemd/system/fscrypt-unlock-postgres.service
   [Unit]
   Description=Unlock fscrypt-encrypted Postgres data directory
   DefaultDependencies=no
   Before=docker.service
   RequiresMountsFor=/var/lib/docker

   [Service]
   Type=oneshot
   ExecStart=/usr/bin/fscrypt unlock /var/lib/docker/volumes/chatsift-v3-postgres-data/_data --key=/etc/fscrypt-postgres.key --quiet
   RemainAfterExit=yes

   [Install]
   WantedBy=multi-user.target
   ```

   `unlock` doesn't accept `--source` at all (that's an `encrypt`-only flag, for choosing what kind of _new_
   protector to create) — only `--key=FILE` for the raw-key path here, and `--quiet` since this runs with no TTY
   at boot and must never sit waiting on a prompt it can't answer. Confirm `which fscrypt` matches the binary path
   in `ExecStart` before enabling — worth checking per-host, not assumed from this doc.

   `Before=docker.service` alone only orders the two units when both are going to start anyway — it doesn't stop
   Docker from starting if the unlock fails. A drop-in on `docker.service` itself turns that into a hard
   dependency, so a failed unlock actually blocks Docker (and therefore the `postgres` container) from starting
   against a missing/still-locked directory instead of quietly booting into an empty one:

   ```ini
   # /etc/systemd/system/docker.service.d/10-fscrypt-postgres.conf
   [Unit]
   Requires=fscrypt-unlock-postgres.service
   After=fscrypt-unlock-postgres.service
   ```

   ```sh
   sudo systemctl daemon-reload
   sudo systemctl enable fscrypt-unlock-postgres.service
   ```

7. **Test the happy path for real** during a maintenance window — this is the non-negotiable one, since it's what
   every routine reboot going forward actually depends on:

   ```sh
   reboot
   # after it comes back:
   systemctl status fscrypt-unlock-postgres.service
   journalctl -b -u fscrypt-unlock-postgres.service --no-pager
   fscrypt status /var/lib/docker/volumes/chatsift-v3-postgres-data/_data   # Unlocked: Yes
   docker compose ps                                                        # everything back on its own
   ./compose logs postgres --tail 30                                        # clean start, no recovery warnings
   ```

   Before this reboot, it's worth a lower-risk dry run of the unlock command itself, without touching the host's
   boot sequence at all: `./compose stop postgres`, `fscrypt lock <dir>`, `systemctl start
fscrypt-unlock-postgres.service`, confirm it succeeds and `fscrypt status` flips back to `Unlocked: Yes`, then
   `./compose up -d postgres`. Catches a broken `ExecStart` line without needing a reboot to find out.

   **The failure-path half — temporarily moving the keyfile aside, rebooting, and confirming `docker.service`
   correctly refuses to start — is worth doing if the host is otherwise idle, but is a judgment call to skip on a
   host that also carries other live production workloads.** `Requires=`/`After=` is well-understood, standard
   systemd behavior, not something exotic that needs live proof to trust; deliberately breaking a boot sequence to
   confirm a negative isn't worth the risk on a shared box once the happy path is already confirmed. If skipped,
   say so explicitly (don't let it read as "forgotten") and revisit on the next host this runs on. **If this step
   is skipped, immediately move the keyfile back to its real path** if it was relocated as prep — an _unplanned_
   reboot before that happens hits the failure path for real, not as a test.

What this does and doesn't defend against: it protects data if the disk is stolen or a backup/snapshot is exposed
on Hetzner's side (the actual scenario "encryption at rest" targets). It does not protect against a live
compromise of the host itself — the key has to be available for Postgres to restart unattended, so a root-level
attacker on a running box can read the unlocked data either way, same as any at-rest scheme for an
always-on service.

## Database backups

Nightly logical backups of the whole Postgres cluster into a [restic](https://restic.net) repository on S3, taken
by the `pg-backup` service. It is gated behind the `backup` compose profile, so **only prod takes them** -- a dev or
canary checkout that enabled it would write its throwaway data into the production repository.

### What replaced what, and why

The old `ChatSift/stack` deployment ran `kartoza/pg-backup:12.4` and **never deleted a single backup**. Its
`REMOVE_BEFORE: 30` is implemented as `find ${MYBASEDIR}/* -type f -mmin +N -delete` over the container's own
scratch directory; with `STORAGE_BACKEND=S3` the dumps are pushed to the bucket and that `find` sweeps a directory
the bucket knows nothing about. Thirty-day retention was therefore a manual chore against the S3 console for as
long as it ran. Upstream did eventually grow a real `run_s3_retention`, long after the version pinned there.

That image could not have been lifted across regardless: its `pg_dump` is v12, and pg_dump refuses outright to dump
a server newer than itself, so it cannot read the 17 cluster at all. Hence `build/pg-backup/` -- a `postgres:17-alpine`
base (the same floating tag as the server, so the two can never drift apart again) plus restic, and
`build/pg-backup/backup.sh`, which is short enough to read in one sitting.

restic rather than dumps-as-objects plus a hand-written pruner, because the pruner is the part that broke last
time: `restic forget --keep-daily` is tested upstream code that will not empty a repository, `restic check` verifies
the backups without a restore, and the dumps compress ~50x in the repository.

### Layout and configuration

The repository lives at `s3://chatsift/new` -- `BACKUP_S3_PREFIX` in `.env.public`. The `new/` prefix exists because
the bucket is shared with the retiring `ChatSift/stack` deployment, whose own backups sit at the bucket root. Once
that stack is gone the prefix can be collapsed, but note it names the repository itself: moving it is
`aws s3 mv --recursive` plus the env change, not something to do casually.

Everything else is in `.env.public` (schedule hour, `--keep-daily`/`--keep-last`, bucket and endpoint) except the
three secrets in `.env.private`: `BACKUP_AWS_ACCESS_KEY_ID`, `BACKUP_AWS_SECRET_ACCESS_KEY` and
`BACKUP_RESTIC_PASSWORD`. They are spelled `BACKUP_*` rather than `AWS_*` because both env files are loaded into
every container in the stack; `docker-compose.yml` maps them onto the real names for this one service, so no bot
that processes untrusted Discord input ends up holding ambient bucket credentials.

> **`BACKUP_RESTIC_PASSWORD` belongs in the password manager before the first `./compose up`, not after.** restic
> has no unencrypted mode, so the backups are encrypted whether or not you wanted that, and without this password
> every one of them is permanently unreadable no matter who holds the S3 credentials. Same class of secret as
> `ENCRYPTION_KEY` and the fscrypt key above.

Two things the design deliberately does not do:

- **There is no Prometheus metric and no Grafana rule behind this.** Failures go to stderr and reach you through
  the Dozzle relay like any other container's errors. The gap that leaves is a container that never starts at all,
  which produces no stderr either -- `./compose ps` and the `last-success` marker below are what answer that.
- **The S3 credentials can delete objects**, because `restic prune` needs to. A host compromise therefore reaches
  the backups. Scoping the IAM policy to `s3:{Put,Get,List,Delete}Object` on `chatsift/new/*` limits the blast
  radius to this prefix, and bucket versioning plus a noncurrent-version lifecycle rule would close it properly.
  Neither is set up today. **Do not put an expiration lifecycle rule on `new/` itself** -- it would delete pack
  files the repository still references and corrupt every snapshot in it.

### Operating it

```sh
./compose logs pg-backup --tail 50          # what the last run did
./compose exec pg-backup cat /var/lib/pg-backup/last-success   # unix ts of the last good run
./compose exec pg-backup restic snapshots   # what is actually in the bucket
./compose exec pg-backup restic stats --mode raw-data
```

To force a run outside the window, clear the marker and restart -- the container backs up on startup whenever the
last success is more than 24h old:

```sh
./compose exec pg-backup rm -f /var/lib/pg-backup/last-success
./compose restart pg-backup
```

If a container was killed mid-run the repository keeps a lock; the next run clears stale locks itself, and
`restic unlock` does it by hand.

### Restoring

The dumps are stored as ordinary `pg_dump --format=custom` archives, so recovery needs restic, `pg_restore`, and
the password -- nothing from this repo. Off a dead host, that is any machine with the restic binary:

```sh
export RESTIC_REPOSITORY='s3:s3.amazonaws.com/chatsift/new'
export RESTIC_PASSWORD='...'          # from the password manager
export AWS_ACCESS_KEY_ID='...' AWS_SECRET_ACCESS_KEY='...'

restic snapshots                       # pick one; `latest` is the newest
restic restore latest --target /tmp/restore
ls /tmp/restore/var/lib/pg-backup/work # globals.sql, chatsift.dump, glitchtip.dump, postgres.dump
```

Then, against a **fresh** cluster, roles first (every object in the dumps is owned by one of them):

```sh
psql --username=chatsift --dbname=postgres --file=/tmp/restore/var/lib/pg-backup/work/globals.sql
createdb --username=chatsift chatsift
pg_restore --username=chatsift --dbname=chatsift /tmp/restore/var/lib/pg-backup/work/chatsift.dump
```

**Restore as `chatsift`, into a cluster this repo's `postgres` service provisioned** -- not as `postgres` into a
plain one, which is the tempting improvisation when you are rebuilding a host in a hurry. `globals.sql` ends with

```sql
GRANT pg_monitor TO chatsift_exporter WITH INHERIT TRUE GRANTED BY chatsift;
```

and Postgres 16+ tracks a role grant's grantor strictly: `GRANTED BY chatsift` fails for any other role, superuser
or not. Restoring as `postgres` therefore leaves `chatsift_exporter` without `pg_monitor`, and the only sign is one
`permission denied to grant privileges as role "chatsift"` line in a wall of psql output. The cluster comes up
looking fine and the #270 query dashboard quietly shows `<insufficient privilege>` instead of query text (see
`build/postgres/init/02-monitoring-role.sh`). Restoring as `chatsift` reports a harmless
`role "chatsift" already exists` instead, and the grant lands. Verified in the 2026-09-11 drill, both ways.

A single file can also be streamed straight out without materializing the whole snapshot, which is the fast path
when you only want the product database:

```sh
restic dump latest /var/lib/pg-backup/work/chatsift.dump | pg_restore --dbname=chatsift
```

### The drill

**A backup nobody has restored is not a backup.** Worth doing once a quarter, and after any Postgres major version
bump:

1. `restic check --read-data` -- re-downloads and verifies every pack rather than just the metadata the nightly run
   checks. This costs S3 egress, which is why it is not automatic.
2. Restore the latest snapshot into a scratch database (`createdb restore_drill`, `pg_restore --dbname=restore_drill`)
   and sanity-check a couple of row counts against production.
3. Drop the scratch database.

## Verification standard

Before calling any phase/issue done. **The two halves have different owners** — an agent does the first, the
operator does the second. Typecheck and unit tests verify code correctness, not feature correctness, and an agent
cannot close that gap on its own: it has no Discord connection and no browser session.

### What an agent can and must verify

1. `turbo run build lint test format:check` green. (Prefer the allowlisted `yarn build` / `yarn lint` / `yarn test`
   shapes — they avoid extra permission prompts.) All four are per-package turbo tasks, so a repeat run is a cache
   hit; use `--force` if you need to distrust the cache.
2. Anything genuinely checkable without Discord or an authenticated session:
   - Unit tests for pure logic — see `services/modmail-bot/src/lib/__tests__/` for the existing patterns. Vitest
     runs per package (`vitest.shared.ts` + a `vitest.config.ts` per workspace), so watch mode is
     `yarn workspace <name> test:watch` rather than a root-level command.
   - A locally-running API: confirm a new route is actually mounted, i.e. it returns **401 rather than 404**. That's
     the ceiling without a session, and it's still worth doing — it catches a route that was written but never
     registered.
   - SQL/migration scripts, diffed against two throwaway scratch databases (src/dst, offset sequences,
     id-independent diff).
3. Read back the code paths the change touches, including every call site, rather than assuming.

### What only the operator can verify

Everything with a real Discord or authenticated-dashboard surface: slash commands, panel buttons, ticket flows, DM
handling, OAuth, and all dashboard UI behaviour. Frontend work is the sharpest case — a Tailwind class that compiles
to nothing (see [frontend.md](frontend.md#theme-and-colour-tokens)) passes build _and_ lint and still renders wrong.

**Report honestly.** State what you ran and what passed. Do not describe a feature as working, verified, or done
when only the typecheck/test half was possible — say explicitly which parts remain, and list the specific golden
path and edge cases worth clicking through, so the manual pass is a checklist rather than a guess.

### Milestones

For milestones with an explicit acceptance-criteria list (M1's zero-`@ts-expect-error` gate, M4/M5's
migration-reconciliation checks), confirm each item explicitly before closing the milestone.

## Where to look first

New to a piece of this work? Start at [roadmap/00-overview.md](roadmap/00-overview.md), then [roadmap/01-architecture.md](roadmap/01-architecture.md) for the current shape of whatever you're touching (`02`–`04` were removed once M1–M3 shipped; `05`/`06` are the two still-active milestone docs, AMA cutover and ModMail migration respectively). The two ADRs ([0001](adr/0001-api-contract-pattern.md), [0002](adr/0002-db-stack.md)) explain _why_ the two big architectural changes were made, in case a decision looks arguable in the moment — reread the ADR before re-relitigating it.
