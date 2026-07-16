# M1 — Foundation refactor spec

**Milestone target:** ~2026-08-20 (4 weeks from kickoff at ~7 hrs/wk). **Depends on:** M0 (this doc set + GitHub setup). **Blocks:** M2, M3 (both should be built directly on the new pattern, not on the old one).

## Goal

Land the two ADR decisions ([0001](../adr/0001-api-contract-pattern.md) API contract, [0002](../adr/0002-db-stack.md) DB stack) with **zero functional change** to the dashboard or API behavior. This is a pure refactor milestone — the acceptance gate is "behaves identically, but the type story is now real."

## Acceptance criteria

- `turbo run build lint` is green across the whole monorepo.
- **Zero `@ts-expect-error` in `apps/website/src/api/*`** (the replacement for today's `data/*`).
- The dashboard's AMA list/detail, grants, and auth/me flows work identically to before, verified by hand against a locally-migrated Postgres instance (`/verify` or manual click-through — this is a refactor, so behavior parity is the test, not new functionality).
- `atlas migrate apply` runs cleanly against a fresh database and produces the same effective schema as the current `prisma/schema.prisma`.
- `atlas migrate down` successfully reverts the latest migration in a scratch environment (proves down-migration support actually works, not just configured).

## Part A — `packages/db`

New workspace package, structure (mirroring SimplyChords' `packages/db`, Atlas in place of `ley`):

```
packages/db/
  src/
    index.ts          # createDb() -> postgres() client factory, exported on getContext()
    generated/         # kanel output (row types) — committed or CI-regenerated, decide during implementation
  schema/
    schema.sql          # (or .hcl) declarative schema — source of truth for Atlas diffing
  migrations/            # atlas-generated versioned migration files
  atlas.hcl              # Atlas project config (env, dev-db URL for diffing)
  kanel.config.js        # kanel config pointing at the dev DB
  package.json
```

Checklist:

1. Stand up `packages/db` package.json (`@chatsift/db`), dependency on `postgres` (porsager).
2. Author the declarative schema reproducing the current 6 models exactly (see [01-architecture.md](01-architecture.md) §5 for the field-level reference): `Experiment`, `ExperimentOverride`, `DashboardGrant`, `AMASession`, `AMAPromptData`, `AMAQuestion` (+ `AMAQuestionState` enum). Naming convention decision: keep Prisma's camelCase-via-quoted-identifiers, or move to snake_case + `postgres.camel` transform (SimplyChords' choice) — **decide and document in this file once chosen** (update this doc when settled, don't leave it ambiguous).

   **Decided: snake_case + `postgres.camel` transform**, matching SimplyChords (`packages/db/src/index.ts` there passes `transform: postgres.camel` to `postgres()`). Reasons: (a) consistency with the reference architecture this milestone is explicitly modeled on; (b) quoted camelCase identifiers are easy to typo into an unquoted (lowercased) reference in raw SQL, a footgun snake_case avoids entirely; (c) kanel's generated row types and the `postgres.camel` transform compose cleanly — DB stays conventional snake_case, JS-facing code stays camelCase. Implemented in `packages/db/schema/schema.sql`.
3. `atlas migrate diff` against an empty dev DB to generate the baseline migration; commit it.
4. Wire `kanel` against a locally-migrated DB; generate `src/generated/`; add an npm script (`db:gen`) and a turbo task.
5. `createDb()` factory: `postgres(env.DATABASE_URL, { /* transform if snake_case chosen */ })`, attached to `getContext()` as `db` (replacing the current Kysely instance — `getContext()` itself is kept, see [ADR 0002](../adr/0002-db-stack.md)).
6. Add `db:migrate` / `db:migrate:down` / `db:gen` scripts at the package and root level; wire into `turbo.json`.
7. Delete `prisma/` and the `prisma-kysely` generator output in `packages/private/core/src/types/entities.ts` once nothing references them.

## Part B — API core (`services/api/src/core/`)

1. Add `core/route.ts`: `defineRoute` factory + `defineMiddleware<TExtra>()` + the `RouteDefinition<...>` type (method/path/body/query/params/response/middleware generics), per [ADR 0001](../adr/0001-api-contract-pattern.md).
2. Add `core/contract.ts`: `InferRouteContract<TRoute>`.
3. Add `core/server.ts`: `mountRoute(route)` — conditional JSON parsing, zod validation of body/query/params (Boom 400 with `error.issues` on failure), middleware chain, response serialization (200+JSON or 204), request-id/logging (port the existing tracking-id + duration-logging behavior from today's `Route.register()`).
4. Convert `isAuthed` (`services/api/src/middleware/isAuthed.ts`) into a typed `defineMiddleware` exposing `req.identity`/`req.tokens` — same runtime logic (JWT verify, 7-min refresh threshold, guild-manager/global-admin checks), just re-typed.
5. Delete `services/api/src/routes/route.ts` (the class), `routes/routes.ts` (value barrel), `routes/_types/` (routeTypes.ts, index.ts) once all routes are migrated (part C).
6. Rewrite `services/api/src/index.ts` to be the type-only frontend-facing entry point (per [ADR 0001](../adr/0001-api-contract-pattern.md)'s example) — re-exporting each route's object + zod schemas as types/values for `import type` consumption. Runtime route registration moves to explicit `mountRoute(...)` calls in `bin.ts` (matching SimplyChords, replacing the current glob-based auto-loading — explicit registration makes the type-only `index.ts` split possible and the boot sequence easier to reason about).

## Part C — route-migration checklist (all 13 routes)

Each route: convert from `Route` subclass → `defineRoute`, and from Kysely → raw SQL via `container.db`. One PR per resource group is a reasonable size (3 PRs), or one per route if preferred — decide based on review cadence.

**AMA (`services/api/src/routes/ama/`) — 5 routes:**
- [ ] `createAMA.ts` — `POST /v3/guilds/:guildId/ama/amas`
- [ ] `getAMA.ts` — `GET /v3/guilds/:guildId/ama/amas/:amaId`
- [ ] `getAMAs.ts` — `GET /v3/guilds/:guildId/ama/amas`
- [ ] `updateAMA.ts` — `PATCH /v3/guilds/:guildId/ama/amas/:amaId`
- [ ] `repostPrompt.ts` — `POST /v3/guilds/:guildId/ama/amas/:amaId/prompt`

**Auth (`services/api/src/routes/auth/`) — 4 routes:**
- [ ] `discord.ts` — `GET /v3/auth/discord`
- [ ] `discordCallback.ts` — `GET /v3/auth/discord/callback`
- [ ] `logout.ts` — `POST /v3/auth/logout`
- [ ] `me.ts` — `GET /v3/auth/me`

**Guilds (`services/api/src/routes/guilds/`) — 4 routes:**
- [ ] `get.ts` — `GET /v3/guilds/:guildId`
- [ ] `createGrant.ts` — `PUT /v3/guilds/:guildId/grants`
- [ ] `deleteGrant.ts` — `DELETE /v3/guilds/:guildId/grants`
- [ ] `getGrants.ts` — `GET /v3/guilds/:guildId/grants`

## Part D — frontend `apps/website/src/api/`

Replace `apps/website/src/data/{common,client,server}.tsx` and `apps/website/src/utils/fetcher.tsx` with:

```
apps/website/src/api/
  fetch.ts        # isomorphic apiFetch(method, path, opts) — branches on typeof window
  queryClient.ts  # makeQueryClient(), getQueryClient (React cache()), hierarchical queryKeys
  error.ts        # APIError class + isClientError()
  token.ts        # client-side access-token store (Jotai atom, replacing per-hook useState)
  serverTokenCache.ts  # server-side refresh->access token cache (replacing the ad-hoc Map)
  routes/
    auth.ts       # useMe(), useLogout()
    guilds.ts     # useGuildInfo(), grants hooks
    ama.ts        # useAMAs(), useAMA(), useCreateAMA(), useUpdateAMA(), useRepostPrompt()
```

Each `routes/<resource>.ts` file derives its types via `InferRouteContract<typeof theRoute>` — no `routesInfo` mirror, no `GettableRoutes`/`MakeOptions` type gymnastics. Prefetch (`server.ts`'s `prefetchMany` equivalent) becomes a `prefetch(queryObjects)` helper in `fetch.ts` per SimplyChords, used the same way in server components (`<HydrationBoundary state={await prefetch([...])}>`).

## Verification

- Run `services/api` + `apps/website` locally against a freshly-`atlas migrate apply`'d database.
- Log in via Discord OAuth, load `/dashboard`, open a guild, view/create/update an AMA, view grants — confirm identical behavior to pre-refactor `main`.
- `atlas migrate down` once in a scratch DB to prove rollback works.
- `turbo run build lint test` green.
