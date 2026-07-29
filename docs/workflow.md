# Workflow

Conventions for working on the ChatSift rebirth (see [roadmap/00-overview.md](roadmap/00-overview.md) for product context).

## Branching & PRs

- Work happens on feature branches off `main`, one PR per logical change. Suggested branch naming: `<type>/<short-description>` (e.g. `feat/ama-guest-queue`, `refactor/defineRoute-ama-routes`, `docs/roadmap-scaffolding`).
- Squash-merge to `main` with a conventional-commit-style message (see below) — keeps `main`'s history one-commit-per-change even if a branch had many WIP commits.
- Reference the relevant milestone/issue in the PR description (`Closes #123`).
- Global merge gate: `turbo run build lint test` green. For changes with a runtime surface (anything other than docs/tests), also do a manual `/verify`-style pass — run the affected service(s) and exercise the change, don't rely on typecheck/tests alone to prove a feature works.

## Commit messages

This repo uses **commitlint** (`@commitlint/config-angular`) enforced by a `commit-msg` husky hook (`.husky/commit-msg`, `.commitlintrc.json`). Allowed types:

```
chore, build, ci, docs, feat, fix, perf, refactor, revert, style, test, types
```

Format: `<type>(<optional scope>): <subject>`. Scope case isn't enforced; exclamation-mark breaking-change markers aren't enforced either (both disabled in `.commitlintrc.json`). Example: `feat(ama-bot): add guest-review queue handlers`.

## Local environment

`docker-compose.yml` provides `postgres`, `redis`, `dozzle` (log viewer), plus containerized `api` and `ama-bot` services built from the root `Dockerfile`. For day-to-day development, run `postgres` + `redis` via compose (`docker compose up -d postgres redis`) and the Node services directly via the root `yarn dev:api` / `yarn dev:ama-bot` scripts — each builds the service (and its workspace deps) with turbo, then runs the built `dist/bin.js` with `.env.private`/`.env.public` auto-loaded via `dotenv-cli`. Re-run the script after making changes; there's no watch mode. This is faster than rebuilding containers each time.

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
`sql\`...\``call is`Proxy`-wrapping the client or rewriting every call site — not worth it when this DB-side
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

## Verification standard

Before calling any phase/issue done:

1. `turbo run build lint test` green.
2. Run the actual affected service(s) locally against a locally-migrated database (and a test Discord guild/bot token for bot-touching work) and exercise the golden path plus the edge cases called out in that phase's doc. Typecheck and unit tests verify code correctness, not feature correctness — this step is not optional for anything with a runtime surface.
3. For milestones with an explicit acceptance-criteria list (M1's zero-`@ts-expect-error` gate, M4/M5's migration-reconciliation checks), confirm each item explicitly before closing the milestone.

## Where to look first

New to a piece of this work? Start at [roadmap/00-overview.md](roadmap/00-overview.md), then the specific phase doc for what you're touching (`roadmap/02` through `06`). The two ADRs ([0001](adr/0001-api-contract-pattern.md), [0002](adr/0002-db-stack.md)) explain _why_ the two big architectural changes were made, in case a decision looks arguable in the moment — reread the ADR before re-relitigating it.
