# Architecture: current vs. target

See [00-overview.md](00-overview.md) for product context. This doc is the technical map: what exists today on `main`, what it becomes, and why. The "why" for the two big changes (API contract, DB stack) is expanded in [ADR 0001](../adr/0001-api-contract-pattern.md) and [ADR 0002](../adr/0002-db-stack.md).

## Monorepo layout (kept as-is)

Yarn 4 (Berry) workspaces + Turborepo. ESM throughout.

- `apps/website` (`@chatsift/website`) — Next.js 15 App Router dashboard/frontend.
- `services/api` (`@chatsift/api`) — HTTP API, polka.
- `services/ama-bot` (`@chatsift/ama-bot`) — AMA gateway Discord bot (`@discordjs/core`/`ws`, Components V2).
- `packages/private/core` (`@chatsift/core`) — framework-agnostic shared types/constants (DB entity types, `NewAccessTokenHeader`, permissions helpers).
- `packages/private/backend-core` (`@chatsift/backend-core`) — backend runtime foundation: `getContext()`/`initContext()` (db, logger, redis, env), Redis-backed data stores.
- `packages/public/*` — publishable utilities (`discord-utils`, `parse-relative-time`, `pino-rotate-file`).
- `prisma/` — currently the Prisma schema + migrations (being replaced, see below).

None of this top-level shape changes. What changes is (1) how `services/api` defines routes and how `apps/website` consumes them, and (2) how the database schema/migrations/types are produced, replacing `prisma/` with a new `packages/db`.

## 1. API contract — current vs. target

### Current (`main`, being replaced)

A class-based `Route<TResult, TBodyOrQueryZodType>` abstraction (`services/api/src/routes/route.ts`):

```ts
export abstract class Route<TResult, TBodyOrQueryZodType extends ZodType<any> | never> {
	public readonly __internalOnlyHereForTypeInferrenceDoNotUse__!: {
		bodyOrQuery: z.infer<TBodyOrQueryZodType>;
		result: TResult;
	};
	public abstract info: RouteInfo; // { method, path }
	public readonly middleware: Middleware<TRequest<any>>[] = [];
	public readonly bodyValidationSchema: TBodyOrQueryZodType | null = null;
	public readonly queryValidationSchema: TBodyOrQueryZodType | null = null;
	public abstract handle(req, res, next): unknown;
	public register(server: Polka<TRequest<any>>): void {
		/* wires logging + validation + calls handle */
	}
}
```

Each route is a file like `services/api/src/routes/ama/getAMAs.ts` subclassing `Route`. Routes are **filesystem-glob loaded** at boot (`services/api/src/index.ts` globs `routes/**/*.js`), and separately **value re-exported** (`services/api/src/routes/routes.ts`) and **type re-exported** (`services/api/src/routes/_types/index.ts`, `routeTypes.ts`).

`routeTypes.ts` then reflects over the value exports to synthesize a path→method→route type map at the type level (`APIRoutes`, `InferAPIRouteResult`, `InferAPIRouteBodyOrQuery`).

On the frontend, `apps/website/src/data/common.ts` hand-maintains a **second, parallel copy** of every route's path/params/query as a plain object (`routesInfo`), which `data/client.tsx` and `data/server.ts` use to build fetches and type results via `InferAPIRouteResult`.

**The core problem:** the inference doesn't actually hold. Both `data/client.tsx` and `data/server.ts` contain casts like:

```ts
// @ts-expect-error - This won't ever compile
const data = (await fetcher()) as Promise<InferAPIRouteResult<Options['path'], 'GET'> | null>;
```

So the result and body/query types are asserted, not verified. You pay full maintenance cost — every new endpoint touches the route file, `routes.ts`, `_types/index.ts`, `common.ts`, `client.tsx`, and often `server.ts` — for safety that's mostly illusory. Full detail and more excerpts in [ADR 0001](../adr/0001-api-contract-pattern.md).

### Target (SimplyChords pattern)

A **functional** `defineRoute` factory (`services/api/src/core/route.ts` in the target layout) that lets TypeScript infer the contract from the handler's actual return type — no phantom fields, no reflection over value exports:

```ts
export const getAMAsRoute = defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/ama/amas',
	schema: { query: getAMAsQuerySchema, response: getAMAsResponseSchema },
	middleware: [isGuildManager] as const,
	async handler(req) {
		const { guildId } = req.params;
		const { includeEnded } = req.query; // typed from schema.query
		// ...raw SQL query via container.db...
		return sessions; // becomes the inferred response type
	},
});
```

`services/api/src/core/contract.ts` provides the one generic that matters:

```ts
export type InferRouteContract<TRoute> =
	TRoute extends RouteDefinition<
		infer TMethod,
		infer TPath,
		infer TBody,
		infer TQuery,
		infer TParams,
		infer TResponse,
		infer _M
	>
		? { body: TBody; query: TQuery; params: TParams; response: TResponse; method: TMethod; path: TPath }
		: never;
```

`services/api/src/index.ts` becomes **type-only for the frontend** — it re-exports route objects and their zod schemas so the frontend can `import type` them (zero API runtime code ships to the browser) and reuse the exact same zod schema for client-side form validation:

```ts
// This file is NOT the runtime entry point (that's bin.ts). It exists to give the
// frontend typed access to routes as a workspace package.
export type { InferRouteContract } from './core/contract.js';
export { getAMAsSchema, getAMAsRoute } from './routes/ama/getAMAs.js';
// ...one line per route
```

On the frontend, `apps/website/src/api/routes/ama.ts` derives everything from the route object — no hand-mirrored path/param registry:

```ts
import type { InferRouteContract, getAMAsRoute } from '@chatsift/api';

type GetAMAsContract = InferRouteContract<typeof getAMAsRoute>;
export type AMASession = GetAMAsContract['response'][number];

export function useAMAs(guildId: string, query: GetAMAsContract['query']) {
	return useQuery({
		queryKey: queryKeys.ama.list(guildId, query),
		queryFn: () => apiFetch<AMASession[]>('get', `/v3/guilds/${guildId}/ama/amas`, { query }),
	});
}
```

If a handler's return shape changes, `apps/website` fails to typecheck — for real, no cast. Full detail (mount pipeline, typed middleware context, `apiFetch`/`queryClient`/`error`/`token` frontend layer) in [ADR 0001](../adr/0001-api-contract-pattern.md) and the route-migration checklist in [02-foundation.md](02-foundation.md).

## 2. Database — current vs. target

### Current (`main`, being replaced)

- **Schema:** `prisma/schema.prisma` — 6 models: `Experiment`, `ExperimentOverride`, `DashboardGrant`, `AMASession`, `AMAPromptData`, `AMAQuestion` (+ `AMAQuestionState` enum).
- **Migrations:** `prisma migrate` — forward-only in practice; down migrations require a manual `migrate diff` + `db execute`, not first-class.
- **Types:** the `prisma-kysely` generator outputs Kysely-compatible types to `packages/private/core/src/types/entities.ts`.
- **Runtime queries:** Kysely query builder, e.g. (`services/api/src/routes/ama/getAMAs.ts`):
  ```ts
  const sessions = await getContext()
  	.db.selectFrom('AMASession')
  	.selectAll()
  	.where('guildId', '=', guildId)
  	.orderBy('id', 'desc')
  	.execute();
  ```

This works, but ties schema authoring to Prisma's DSL, doesn't give first-class rollback, and isn't the raw-SQL style preferred going forward.

### Target (SimplyChords pattern)

New package `packages/db` (mirrors SimplyChords' `@simplychords/db`):

- **Schema:** a declarative schema (SQL or Atlas HCL) describing the same tables, owned by `packages/db`.
- **Migrations:** [Atlas](https://atlasgo.io) (`ariga/atlas`) — `atlas migrate diff` auto-generates a versioned migration by diffing the declarative schema against migration history; `atlas migrate apply` applies it; `atlas migrate down` reverts. 50+ built-in safety analyzers catch destructive changes (dropped columns, table rewrites, etc.) in CI via `atlas migrate lint`.
- **Types:** [kanel](https://kristiandupont.github.io/kanel/) introspects the live database and generates matching TypeScript row types into `packages/db/src/generated/`.
- **Runtime queries:** [`porsager/postgres`](https://github.com/porsager/postgres) (the `postgres` npm package, commonly nicknamed "postgres.js") — raw SQL tagged templates with generic row typing:
  ```ts
  const sessions = await container.db<AMASessionRow[]>`
    SELECT * FROM ama_sessions WHERE guild_id = ${guildId} ORDER BY id DESC
  `;
  ```
  `container.db` is a `postgres()` client instance held on `getContext()` (this repo keeps `getContext()`; SimplyChords' DI-container-via-module-augmentation is not required — see [ADR 0002](../adr/0002-db-stack.md) for why).

Full comparison against alternatives (Drizzle, Prisma 7 TypedSQL, pgTyped) and the reasoning for this exact combination is in [ADR 0002](../adr/0002-db-stack.md).

## 3. What's explicitly kept unchanged

- **HTTP framework:** polka (not Express/Fastify).
- **Validation:** Zod v4.
- **Error handling:** `@hapi/boom`.
- **Frontend data-fetching library:** TanStack Query v5 (only the hooks around it change, not the library).
- **Frontend framework:** Next.js App Router, React 18/19, React Compiler.
- **Frontend state/UI:** Jotai, Tailwind, react-aria-components, Radix.
- **Auth scheme** (see below) — unchanged in mechanism, just re-typed onto the new contract pattern.
- **`ama-bot` gateway/component architecture:** `@discordjs/core`/`ws`, the `ComponentHandler` glob-loader (`lib/components.ts`), the queue state machine shape (`lib/queues.ts`) — extended, not replaced (see [04-ama-complete.md](04-ama-complete.md)).

## 4. Auth flow (unchanged mechanism, reference)

JWT-based, split across cookie + header — already close to the SimplyChords shape, so no redesign needed:

1. `GET /v3/auth/discord` — sets a signed `state` cookie, redirects to Discord OAuth (scopes: identify, email, guilds, guilds.members.read).
2. `GET /v3/auth/discord/callback` — validates state, exchanges code, calls `fetchMe`, issues tokens.
3. **Refresh token** — JWT, 30-day, httpOnly `refresh_token` cookie, contains Discord access/refresh tokens.
4. **Access token** — JWT, 5-minute, delivered via the `X-Update-Access-Token` response header (never a cookie), contains `grants.adminGuilds`.
5. `isAuthed({ fallthrough, isGlobalAdmin, isGuildManager })` middleware verifies the refresh cookie, reads the access token from `Authorization`, auto-refreshes if <7 min remain, and gates on global-admin or guild-manager membership.
6. Frontend: `apps/website/src/proxy.ts` redirects `/dashboard/*` to the API login URL if no `refresh_token` cookie; the client fetcher stores the rotating access token in memory (Jotai atom in the target layout, `useState` today) and re-reads `X-Update-Access-Token` on every response.

Under the target contract pattern, `isAuthed` becomes a typed `defineMiddleware` that attaches `req.identity`/`req.tokens` onto the handler's `req` type — same runtime behavior, real typing.

### 4a. Grant-token auth (one-time, scoped) (#194)

A second, independent auth path alongside the session flow above: a bot slash command mints a short-lived,
single-capability JWT and embeds it in a dashboard URL, so a user with no browser session can still perform the
one action Discord already proved they're allowed to do (having run the command at all, gated by
`.setDefaultMemberPermissions(...)` on that command). First consumer: `/ama create`
(`services/ama-bot/src/commands/ama.ts`) — see [04-ama-complete.md](04-ama-complete.md) Cluster 2.

- **Token shape** (`GrantTokenData`, `packages/private/backend-core/src/lib/grantToken.ts`): `{ kind: 'grant', sub,
guildId, grant, jti, iat }`, signed with the same `ENCRYPTION_KEY` as the session tokens above, 15-minute expiry.
  `kind: 'grant'` is a hard discriminator — without it, a grant token has no `refresh` field either, and would
  otherwise pass the session access-token check and be treated as a valid session. `GRANTS` (same file) is the
  registry of capability strings (currently just `ama:create`); `createGrantToken()`/`verifyGrantToken()` mint and
  verify it, `isGrantConsumed()`/`consumeGrantToken()` enforce one-time use via a `grant:used:<jti>` Redis key.
- **API side** (`services/api/src/middleware/isAuthed.ts`): routes opt in per-route via a new `grants: GrantString[]`
  option. A fast path at the top of `isAuthed`'s first middleware verifies the token and, on a match, sets
  `req.grant` and calls `next()` **before any cookie/refresh/access-token logic runs at all** — a grant request
  never sets `X-Update-Access-Token` or touches the `refresh_token` cookie, so it can't interfere with a real
  session in the same browser. A route's `:guildId` param (if it has one) must match the token's `guildId`; routes
  without one (`/v3/auth/me`) use the token's `guildId` directly instead. Falls through to normal session auth if
  the header holds a real access token instead of a grant. Opted-in routes: `getGuild`, `createAMA`, `getAMAs`, and
  `/v3/auth/me` (see below) — each still declares which specific grant strings it accepts.
- **`/v3/auth/me` under a grant** (`services/api/src/util/me.ts`'s `fetchMeFromGrant`): there's no Discord OAuth
  access token to call `/users/@me` with, so it uses the bot's own REST client (already a member of the grant's
  guild) to fetch just the acting user and that one guild, returning a `Me` shaped exactly like a real session's but
  with a single-entry `guilds` array. This is what lets the frontend reuse the _same_ dashboard route and shared
  components (`useMe()`, `GuildNav`, `DashboardCrumbs`, ...) instead of a parallel minimal page.
- **Frontend** (`apps/website/src/api/grant.ts`'s `useGrantAuth()`): reads `?token=` and decodes the JWT payload
  client-side to drive rendering — this is NOT verification (no `ENCRYPTION_KEY` in the browser), the API
  re-verifies the signature on every request regardless. Deliberately scoped to one exact route
  (`/dashboard/:guildId/ama/amas/new`) via regex: an unscoped check would let a forged `token` query param on _any_
  dashboard route flip `NavGateProvider`/`NavGateCheck`'s client-side gates for that route too, since the decode
  isn't cryptographic. `apiFetch`'s `authToken` option (`api/fetch.ts`) sends the grant token instead of the stored
  session and forces `credentials: 'omit'`, so the token never touches `accessTokenAtom` or cookies. `useMe()`,
  `useGuildInfo()`, `useAMAs()`, `useCreateAMA()` all call `useGrantAuth()` internally and transparently switch to
  grant auth when active — call sites don't need to know grant auth exists. `useMe()`'s query is cached under a
  separate key (`queryKeys.auth.meGrant(token)`) so it can never collide with the real session's `me` cache entry.
- **Dashboard chrome while a grant is active:** `GuildNav` and `DashboardCrumbs` render tabs/breadcrumbs as
  non-interactive (no `href`) rather than hiding them, since the grant only authorizes the one page it links to —
  navigating anywhere else would 401. `UserDesktop`/`UserMobile` show the grant's user avatar (via the real,
  grant-authed `/me` response) with no login/logout button. `apps/website/src/proxy.ts` exempts exactly this one
  route from its cookie-presence redirect when a `token` param is present (presence only, not verified — same
  "UX gate, not a security boundary" reasoning as the frontend decode above).
- **One-time use:** enforced server-side only. `createAMA`'s handler calls `consumeGrantToken(req.grant.jti)` after
  its DB transaction succeeds (not before) — a failed/invalid submit doesn't cost the user their single-use link.

## 5. Data model reference (current 6 models, kept in target schema)

From `prisma/schema.prisma` (to be reproduced in the new Atlas schema, see [02-foundation.md](02-foundation.md)):

- `Experiment` / `ExperimentOverride` — feature-flag rollout ranges + per-guild overrides.
- `DashboardGrant` — grants a `userId` dashboard-management access to a `guildId`.
- `AMASession` — one AMA: `guildId`, `title`, channel routing (`modQueueId?`, `flaggedQueueId?`, `guestQueueId?`, `answersChannelId`, `promptChannelId`), `allowedQuestionUploads`, `ended`.
- `AMAPromptData` — the posted prompt message for a session (`promptMessageId` unique, `promptJSONData` for reposting). 1:1 with `AMASession`.
- `AMAQuestion` — a submitted question: `authorId`, `content`, `state` (`AMAQuestionState`: `PENDING_MOD_REVIEW | PENDING_GUEST_REVIEW | FLAGGED | APPROVED | DENIED`), per-queue message IDs.
