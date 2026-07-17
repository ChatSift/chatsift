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
    generated/         # kanel output (row types) — committed (see step 4), matching the precedent
                       # set by today's committed prisma-kysely output (entities.ts)
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

   Done: `packages/db/migrations/20260716151040_baseline.sql`, generated via `atlas migrate diff baseline --env local` against a real Postgres 17 dev DB (Atlas needs an actual reachable dev-db for its ephemeral diffing container, not just the schema file). Verified `atlas migrate apply` and `atlas migrate down` both work cleanly end-to-end (against a disposable container — **not** the docker-compose `postgres` volume, which already holds real Prisma-migrated dev data and must stay untouched until #132's cutover).

4. Wire `kanel` against a locally-migrated DB; generate `src/generated/`; add an npm script (`db:gen`) and a turbo task.

   Done. Two things worth flagging for whoever touches this next:
   - **`kanel.config.js` had to become `kanel.config.cjs`.** kanel's CLI loads config via a bare `require(configPath)`; under this package's `"type": "module"`, requiring a `.js` file returns the unwrapped `{ default: {...} }` ESM interop shape instead of the config object, so every option (including `connection`) silently vanished and kanel fell back to a bare default `pg` connection. `.cjs` (genuine CommonJS, using `module.exports`) sidesteps the bug entirely — kanel's CLI already checks for `kanel.config.cjs` as a candidate filename.
   - **`getPropertyMetadata` camelCases row property names** (via `@kristiandupont/recase`, `recase('snake', 'camel')`) to match the `postgris.camel` runtime transform (step 5) — kanel only PascalCases type/interface names by default, not properties, so without this override the generated types would carry snake_case keys while actual query results are camelCase at runtime.
   - `@electric-sql/pglite` had to be added as a devDependency purely to satisfy an unconditional (peer, unmet) `require` inside `extract-pg-schema`'s nested `knex-pglite` dependency — kanel's CLI crashes on startup without it even though we never use the pglite driver ourselves.

   `src/generated/` is **committed**, matching the precedent set by today's committed `prisma-kysely` output (`packages/private/core/src/types/entities.ts`) — see the Part A structure diagram above.

5. `createDb()` factory: `postgres(env.DATABASE_URL, { /* transform if snake_case chosen */ })`, attached to `getContext()` as `db` (replacing the current Kysely instance — `getContext()` itself is kept, see [ADR 0002](../adr/0002-db-stack.md)).

   Done: `createDb()` now defaults to `transform: postgres.camel`, overridable via `options`.

6. Add `db:migrate` / `db:migrate:down` / `db:gen` scripts at the package and root level; wire into `turbo.json`.

   Done, plus `db:diff` (`atlas migrate diff`, per [docs/workflow.md](../workflow.md)'s documented mapping) at both levels. Root `db:migrate` now replaces the old Prisma-flavored script (`prisma migrate dev`) — a deliberate decision, since Prisma stays the live DB layer until the route migrations (#126–131) land, but the name collision meant something had to give and the workflow doc already commits to this exact target name. The other Prisma scripts (`db:generate`, `db:format`, `db:reset`, `db:deploy`, `db:studio`) are untouched for now; #132 removes them along with `prisma/` once nothing references Prisma anymore. All four new scripts assume `DATABASE_URL` is already in the environment at the `packages/db`-level (`atlas`/`kanel` invoked directly); the root-level wrappers are the ones that load it via `dotenv -e .env.private -e .env.public`, same convention as the existing Prisma scripts.

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

- [x] `createAMA.ts` — `POST /v3/guilds/:guildId/ama/amas`
- [x] `getAMA.ts` — `GET /v3/guilds/:guildId/ama/amas/:amaId`
- [x] `getAMAs.ts` — `GET /v3/guilds/:guildId/ama/amas`
- [x] `updateAMA.ts` — `PATCH /v3/guilds/:guildId/ama/amas/:amaId`
- [x] `repostPrompt.ts` — `POST /v3/guilds/:guildId/ama/amas/:amaId/prompt`

  Done (#128). Two coexistence decisions worth flagging for whoever does #129/#130 (auth, guilds — the remaining 8
  routes still on `Route`/Kysely):
  - **`getContext()` now carries both `db` (legacy Kysely, untouched) and `rawDb` (new `postgres.js` client from
    `@chatsift/db`, via `createRawDatabase()` in `@chatsift/backend-core`).** `db` stays as-is until every route
    (13 here + the 3 Kysely call sites in `services/ama-bot`) is off it; only then does #132 delete it and `rawDb`
    can take over the `db` name per the ADR's target shape. `services/api/src/index.ts`'s route loader was
    extended to runtime-detect either shape (`typeof mod.default === 'function'` for the legacy `Route` subclass
    vs. a plain `defineRoute` object) and dispatch to `.register()` or `mountRoute()` accordingly — this means
    each resource-group PR only needs to touch its own route files, not the loader again.
  - **AMA's frontend contract is temporarily gone.** The 5 AMA route files no longer export a `Route` subclass, so
    they were dropped from `routes.ts`/`_types/routeTypes.ts` (the class-reflection barrel `_types/index.ts`
    builds `APIRoutes` from). `apps/website`'s AMA data hooks (`data/common.ts`'s `routesInfo.ama`, `data/client`,
    `data/server`) will fail to typecheck against `@chatsift/api` until #131 replaces them with
    `apps/website/src/api/routes/ama.ts` using `InferRouteContract` directly against the migrated route objects —
    deliberately not bridged, since any bridge would be thrown away the moment #131 lands. `turbo run build` on
    `apps/website` is expected red until #131 merges; `services/api`, `services/ama-bot`, and the rest of the
    monorepo stay green.

**Auth (`services/api/src/routes/auth/`) — 4 routes:**

- [x] `discord.ts` — `GET /v3/auth/discord`
- [x] `discordCallback.ts` — `GET /v3/auth/discord/callback`
- [x] `logout.ts` — `POST /v3/auth/logout`
- [x] `me.ts` — `GET /v3/auth/me`

  Done (#129). None of the 4 auth routes issue their own DB queries — `discord.ts`/`logout.ts` are pure
  cookie/redirect/Discord-REST handlers, and `discordCallback.ts`/`me.ts` only reach the DB transitively through
  the shared `fetchMe()` helper (`util/me.ts`), which still queries `DashboardGrant` via legacy Kysely
  (`getContext().db`). `fetchMe` is shared infrastructure also used by `isAuthed`'s `isGuildManager` check and by
  the already-migrated AMA routes (#128) — same precedent as #128, which didn't touch it either. It stays on
  Kysely until the guilds routes (#130, which own the `DashboardGrant` table) migrate it, or #132's cleanup.
  Same coexistence/frontend-breakage notes as #128 apply: `discord.ts`/`discordCallback.ts`/`logout.ts`/`me.ts`
  dropped out of `routes.ts`/`_types/routeTypes.ts`; `apps/website`'s `data/*` hooks for auth are unbridged until
  #131. Verified by hand: built `services/api`, ran it against local Postgres/Redis, and curled all 4 routes —
  `GET /v3/auth/discord` (no cookies) 302s to the correct Discord OAuth URL with `state` cookie set;
  `GET /v3/auth/me` and `POST /v3/auth/logout` (no cookies) both 401; `GET /v3/auth/discord/callback` 400s on
  missing query and on state mismatch — all byte-for-byte matching the pre-migration `Route`-class behavior. Full
  interactive Discord login (browser click-through) still needs to be exercised manually against a real Discord
  application before merge.

**Guilds (`services/api/src/routes/guilds/`) — 4 routes:**

- [x] `get.ts` — `GET /v3/guilds/:guildId`
- [x] `createGrant.ts` — `PUT /v3/guilds/:guildId/grants`
- [x] `deleteGrant.ts` — `DELETE /v3/guilds/:guildId/grants`
- [x] `getGrants.ts` — `GET /v3/guilds/:guildId/grants`

  Done (#130). All 4 routes now issue raw SQL against `dashboard_grants` via `container.rawDb`
  (`@chatsift/db`'s `DashboardGrants`/`DashboardGrantsId` types, newly re-exported from the package root). This
  route group owns the `dashboard_grants` table, so `fetchMe()` (`util/me.ts`) — shared by `isAuthed`'s
  `isGuildManager` check and `GET /v3/auth/me` — was migrated off legacy Kysely (`getContext().db`) to `rawDb` in
  the same PR, per the note left in #129's entry above. `createGrant.ts`/`deleteGrant.ts` intentionally still
  manually set `res.statusCode = 200; res.end()` (matching `logout.ts`'s precedent) rather than returning `void`
  from the handler, to preserve the pre-migration empty-200-body response exactly instead of `mountRoute`'s
  default 204-on-`undefined`.

  **This was the last of the 13 routes (Part C), which unblocked Part B step 5**: `routes/route.ts` (the legacy
  `Route` class), `routes/routes.ts` (the value barrel), and `routes/_types/` (`routeTypes.ts` + the
  `APIRoutes`-building `index.ts`) are now deleted — leaving them as empty stubs after dropping the guilds
  entries broke `turbo run build` (`File '...routes.ts' is not a module`), and Part B step 5 already specified
  deleting them "once all routes are migrated," which is now true. `services/api/src/index.ts`'s route loader no
  longer branches on `typeof mod.default === 'function'`; every route file is a `defineRoute` object now, so it
  always calls `mountRoute`. `middleware/validate.ts` (only used by the legacy `Route` class) and its test were
  also deleted as dead code. `getContext().db` (legacy Kysely) itself is untouched — #132 still owns removing
  Prisma/Kysely once the 3 Kysely call sites in `services/ama-bot` are also migrated.

  Same coexistence/frontend-breakage notes as #128/#129 apply: `apps/website`'s `data/*` hooks for guilds are
  unbridged until #131; `turbo run build` on `apps/website` stays red on the pre-existing `AMASessionDetailed`
  gap from #128, unrelated to this PR. Verified by hand: built `services/api`, applied the Atlas baseline
  migration to a disposable scratch Postgres (not the docker-compose volume, per Part A step 3's precedent —
  `dashboard_grants` doesn't exist there yet since it's never had `atlas migrate apply` run against it), and
  exercised the exact SQL from `createGrant`/`deleteGrant`/`getGrants`/`fetchMe` directly against it: insert,
  duplicate-check, select, delete, and the `dashboard_grants_guild_id_user_id_key` unique constraint all behaved
  as expected with `postgres.camel`-transformed results. Separately booted the real `bin()` server (scratch
  Postgres + the existing dev Redis) and curled all 4 routes with no cookies — all four 401, and validation-before-auth
  ordering matches the pre-migration `Route`-class behavior. Full interactive Discord login + guild-manager
  click-through (create/delete a grant from the dashboard) still needs to be exercised manually against a real
  Discord application before merge — same caveat #129 left, since `apps/website` can't drive it until #131 and
  `isGuildManager` calls the real Discord API inside `fetchMe`.

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
