# Architecture

See [00-overview.md](00-overview.md) for product context. This doc is the technical map of `main`. The "why" for the two big changes below (API contract, DB stack) is expanded in [ADR 0001](../adr/0001-api-contract-pattern.md) and [ADR 0002](../adr/0002-db-stack.md).

> **Status:** both changes described below shipped in M1 (2026-07-17) and are the actual current state of the code, not a future target — the "Current"/"Target" labels on the two subsections are kept because the ADRs' before/after framing is still useful context for _why_ the target shape looks the way it does. If you're only here to understand what the code does today, read the "Target" subsections; the "Current (being replaced)" ones are historical.

## Monorepo layout (kept as-is)

Yarn 4 (Berry) workspaces + Turborepo. ESM throughout.

- `apps/website` (`@chatsift/website`) — Next.js 15 App Router dashboard/frontend.
- `services/api` (`@chatsift/api`) — HTTP API, polka.
- `services/ama-bot` (`@chatsift/ama-bot`) — AMA gateway Discord bot (`@discordjs/core`/`ws`, Components V2).
- `packages/private/core` (`@chatsift/core`) — framework-agnostic shared types/constants (DB entity types, `NewAccessTokenHeader`, permissions helpers).
- `packages/private/backend-core` (`@chatsift/backend-core`) — backend runtime foundation: `getContext()`/`initContext()` (db, logger, redis, env), Redis-backed data stores.
- `packages/private/bot-core` (`@chatsift/bot-core`) — shared Discord gateway bot framework (client bootstrap, command/component dispatch, the `/deploy` command); extracted from `services/ama-bot` (#217) so `services/modmail-bot` doesn't duplicate it. See §6 below.
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

If a handler's return shape changes, `apps/website` fails to typecheck — for real, no cast. Full detail (mount pipeline, typed middleware context, `apiFetch`/`queryClient`/`error`/`token` frontend layer) in [ADR 0001](../adr/0001-api-contract-pattern.md).

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

**Naming convention: snake_case columns + `postgres.camel` transform** (`packages/db/schema/schema.sql`, `createDb()`), not quoted camelCase identifiers. Decided in M1 over keeping Prisma's quoted-camelCase style, because: (a) it matches the reference architecture (SimplyChords) this stack is modeled on; (b) quoted camelCase identifiers are a footgun in raw SQL — an accidental unquoted reference silently lowercases and resolves to a different (or missing) column; (c) kanel's generated row types and `postgres.camel` compose cleanly — the DB stays conventional snake_case, JS-facing code stays camelCase. For kanel-specific setup gotchas (config file extension, property-name casing, a transitive peer-dep crash), see [workflow.md](../workflow.md#database).

## 3. What's explicitly kept unchanged

- **HTTP framework:** polka (not Express/Fastify).
- **Validation:** Zod v4.
- **Error handling:** `@hapi/boom`.
- **Frontend data-fetching library:** TanStack Query v5 (only the hooks around it change, not the library).
- **Frontend framework:** Next.js App Router, React 18/19, React Compiler.
- **Frontend state/UI:** Jotai, Tailwind, react-aria-components, Radix.
- **Auth scheme** (see below) — unchanged in mechanism, just re-typed onto the new contract pattern.
- **`ama-bot` gateway/component architecture:** `@discordjs/core`/`ws`, the `ComponentHandler` glob-loader, the queue state machine shape (`lib/queues.ts`) — extended, not replaced. The loader/client/dispatch primitives now live in `@chatsift/bot-core` (see §6 below).

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
(`services/ama-bot/src/commands/ama.ts`) — see §6 below.

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

## 5. Data model reference (6 models)

Reproduced from the old `prisma/schema.prisma` into the Atlas schema (`packages/db/schema/schema.sql`) in M1, field semantics unchanged:

- `Experiment` / `ExperimentOverride` — feature-flag rollout ranges + per-guild overrides.
- `DashboardGrant` — grants a `userId` dashboard-management access to a `guildId`.
- `AMASession` — one AMA: `guildId`, `title`, channel routing (`modQueueId?`, `flaggedQueueId?`, `guestQueueId?`, `answersChannelId`, `promptChannelId`), `allowedQuestionUploads`, `ended`.
- `AMAPromptData` — the posted prompt message for a session (`promptMessageId` unique, `promptJSONData` for reposting). 1:1 with `AMASession`.
- `AMAQuestion` — a submitted question: `authorId`, `content`, `state` (`AMAQuestionState`: `PENDING_MOD_REVIEW | PENDING_GUEST_REVIEW | FLAGGED | APPROVED | DENIED`), per-queue message IDs.

## 6. Bot framework (`@chatsift/bot-core`) + AMA bot subsystem (`services/ama-bot`)

A gateway bot (`@discordjs/ws` `WebSocketManager` + `@discordjs/core` `Client`, `Guilds` intent), not an interactions-webhook bot. Landed across M1/M3 as `services/ama-bot`'s own `lib/*`; extracted into the shared `packages/private/bot-core` package in #217 (2026-07-24) so `services/modmail-bot` (M5) can reuse it instead of duplicating it, with `ama-bot` migrated onto the extracted package as its first consumer. `ama-bot`'s runtime behavior is unchanged by the extraction — only where the code lives moved.

**`@chatsift/bot-core`** (`packages/private/bot-core/src/lib/`) — bot-generic, parameterized by the caller:

- `rest.ts`, `gateway.ts` — `createBotRest({ token })` / `createBotGateway({ token, intents, rest })` factories (shard-event logging included); no longer read a bot token off `getContext().env` internally, so every export in this package is safe to import statically regardless of `initContext()` ordering.
- `commands.ts` — `CommandHandler` (`{ name, data, handle, handleAutocomplete? }`), `registerCommandHandler()` (direct registration) and `registerCommandHandlers(commandsDir)` (globs `${commandsDir}/**/*.js`, dynamically imports, registers), plus the `ApplicationCommand`/`ApplicationCommandAutocomplete` dispatch functions. Option parsing still uses `@sapphire/discord-utilities`'s resolvers (no in-repo resolver code).
- `components.ts` — `ComponentHandler<State>` (`{ name, stateStore, handle() }`), `registerComponentHandler()`/`registerComponentHandlers(componentsDir)`, and `MessageComponent` dispatch; `custom_id` format is `name:stateId` with optional Redis-backed state via the handler's `stateStore`.
- `collector.ts` — `collectModal(id, waitFor)`, a one-off modal-submit awaiter for the button→modal flows the dispatcher doesn't route (modals aren't dispatched through `components.ts`).
- `deploy.ts` — the shared `/deploy` command (admin-gated via `env.ADMINS`, bulk-overwrites **global** commands from every registered handler's `data` — deliberately global-only, no per-guild registration). `createBotClient` registers it automatically, so no service discovers or wires it up itself.
- `client.ts` — `createBotClient({ botId, gateway, rest })` builds the `@discordjs/core` `Client` and owns: interaction routing (dispatches to the three functions above with a per-interaction child logger), guild-set tracking with a periodic `GuildList.set(botId, ...)` Redis sync (`bot:<BotId>` key, so the API knows which guilds each bot is in), the fresh-app bootstrap that seeds `/deploy` as the only global command, and registering the shared `/deploy` command itself. Declares `ContextService.client` via `declare module '@chatsift/backend-core'`.

**`services/ama-bot`** — everything AMA-specific, built on top of `@chatsift/bot-core`:

- `bin.ts` — process entry: `initContext()`, then `createBotRest`/`createBotGateway`/`createBotClient` with `botId: 'AMA'` and `env.AMA_BOT_TOKEN`, `setServiceValue('client', ...)`, then registers its own `commands`/`components` dirs and connects.
- `commands/ama.ts` — the `/ama` command set: `create` (ephemeral reply linking to the dashboard's create screen, grant-token-authed — see §4a above), `end` (ephemeral select menu of ongoing sessions, flips `ended` via a direct DB write), `repost-prompt` (select menu, replays the stored `AMAPromptData.promptJSONData` verbatim via the bot's own REST client — intentionally not the same client instance `services/api`'s `repostPrompt` route uses, see the file for why). `/ama stats` was deliberately not built (would've duplicated Cluster-4 query logic); still open if anyone wants to pick it up.
- `lib/queues.ts` — the core domain logic:
  - `enum CurrentlyInQueue { mod, guest, answers }` + `getNextQueue()` — a state machine: **mod queue → (optional) guest queue → answers channel**, with an optional **flagged queue** side-branch (flagged is terminal — read-only surface for mods, nothing routes back out of it via the bot).
  - `postToModQueue` / `postToGuestQueue` / `postToFlaggedQueue` / `postToAnswersChannel` — builder functions. Formatting matches prod `ChatSift/AMA`'s `AmaManager.getBaseEmbed` layout exactly (classic embeds, not Components V2 — that was trialed and rejected in favor of prod parity): author name+avatar line, blurple `0x7289da`, footer with `username (id)` only on mod/flagged queues (where a mod needs the raw ID to act), no footer on guest queue/answers channel. `getBaseEmbeds` also adds gallery-grouping (same-`url` trick) for >1 attachment.
- `components/submitQuestion.ts` — user clicks "Submit a question" on the prompt message → modal (text + optional uploads, gated by `allowedQuestionUploads`) → inserts `AMAQuestion` → routes into mod/guest/answers per which queues are configured. Rejects submission once `ended`.
- `components/modApprove.ts` / `modDeny.ts` / `mod-flag` — parse question ID from `custom_id`, advance/deny/flag via `getNextQueue`, disable buttons on the source message.
- `components/guestApprove.ts` / `guestSkip.ts` — guest-side mirror of the mod handlers: atomically claims the row (`WHERE state = 'PENDING_GUEST_REVIEW'`), cleans up a lost-claim race, rejects if the session has ended.
- **No answer-editing surface exists.** Prod `ChatSift/AMA` never posted "the answer" via the bot at all — a mod right-clicks the answers-channel message → "Add Answer" context-menu command → modal → appends a second embed onto the live Discord message, and neither prod nor `main` ever persisted answer text in the DB (only a message-ID pointer). That "Add Answer" flow was never ported to `main` (tracked as #200, open, not scheduled). Editing/reposting a _published_ answer is explicitly out of scope regardless of whether #200 ever lands — owner decision, 2026-07-19: manual Discord message edit/delete is sufficient, not revisited.
- **Stats/export** live on `services/api`, not the bot: `GET /v3/guilds/:guildId/ama/amas/:amaId/stats` (question counts by `AMAQuestionState`) and `GET /v3/guilds/:guildId/ama/amas/:amaId/export` (CSV, RFC 4180 escaping + a leading-`'` guard against CSV/formula injection). Surfaced in the dashboard's AMA detail view.
