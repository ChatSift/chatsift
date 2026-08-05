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
  registry of capability strings: `ama:create` (first consumer, above) plus three ModMail ones added for the M5
  bot's own dashboard-linking slash commands — `modmail:snippet:create` (`/snippet create`), `modmail:config:update`
  (`/config`), `modmail:blocks:read` (`/block-list`); `createGrantToken()`/`verifyGrantToken()` mint and verify it,
  `isGrantConsumed()`/`consumeGrantToken()` enforce one-time use via a `grant:used:<jti>` Redis key.
- **API side** (`services/api/src/middleware/isAuthed.ts`): routes opt in per-route via a new `grants: GrantString[]`
  option. A fast path at the top of `isAuthed`'s first middleware verifies the token and, on a match, sets
  `req.grant` and calls `next()` **before any cookie/refresh/access-token logic runs at all** — a grant request
  never sets `X-Update-Access-Token` or touches the `refresh_token` cookie, so it can't interfere with a real
  session in the same browser. A route's `:guildId` param (if it has one) must match the token's `guildId`; routes
  without one (`/v3/auth/me`) use the token's `guildId` directly instead. Falls through to normal session auth if
  the header holds a real access token instead of a grant. Opted-in routes: `getGuild`, `createAMA`, `getAMAs`,
  ModMail's `getConfig`/`updateConfig`/`listSnippets`/`createSnippet`/`listBlocks`, and `/v3/auth/me` (accepts every
  grant string, since it just needs to resolve _a_ valid grant's identity/guild regardless of which capability it
  carries) — each other route still declares which specific grant strings it accepts.
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
  - `postToModQueue` / `postToGuestQueue` / `postToFlaggedQueue` / `postToAnswersChannel` — builder functions: author name+avatar line, blurple `0x7289da`, footer with `username (id)` only on mod/flagged queues (where a mod needs the raw ID to act), no footer on guest queue/answers channel. Classic embeds, not Components V2 — Components V2 was trialed and rejected in favor of matching `ChatSift/AMA`'s existing embed layout. `getBaseEmbeds` also adds gallery-grouping (same-`url` trick) for >1 attachment.
- `components/submitQuestion.ts` — user clicks "Submit a question" on the prompt message → modal (text + optional uploads, gated by `allowedQuestionUploads`) → inserts `AMAQuestion` → routes into mod/guest/answers per which queues are configured. Rejects submission once `ended`.
- `components/modApprove.ts` / `modDeny.ts` / `mod-flag` — parse question ID from `custom_id`, advance/deny/flag via `getNextQueue`, disable buttons on the source message.
- `components/guestApprove.ts` / `guestSkip.ts` — guest-side mirror of the mod handlers: atomically claims the row (`WHERE state = 'PENDING_GUEST_REVIEW'`), cleans up a lost-claim race, rejects if the session has ended.
- **No answer-editing surface exists.** `ChatSift/AMA` never posted "the answer" via the bot at all — a mod right-clicks the answers-channel message → "Add Answer" context-menu command → modal → appends a second embed onto the live Discord message, and neither `ChatSift/AMA` nor `main` ever persisted answer text in the DB (only a message-ID pointer). That "Add Answer" flow was never ported to `main` (tracked as #200, open, not scheduled). Editing/reposting a _published_ answer is explicitly out of scope regardless of whether #200 ever lands — owner decision, 2026-07-19: manual Discord message edit/delete is sufficient, not revisited.
- **Stats/export** live on `services/api`, not the bot: `GET /v3/guilds/:guildId/ama/amas/:amaId/stats` (question counts by `AMAQuestionState`) and `GET /v3/guilds/:guildId/ama/amas/:amaId/export` (CSV, RFC 4180 escaping + a leading-`'` guard against CSV/formula injection). Surfaced in the dashboard's AMA detail view.

## 6a. ModMail bot subsystem (`services/modmail-bot`) (M5, #152)

> **Status:** the ticket-system rebuild described here shipped and is the actual current state of the code — this is not a forward-looking design. [06-modmail-port.md](06-modmail-port.md) is now scoped down to the one piece of M5 that's still outstanding: the real data migration + cutover from `ChatSift/ModMail`. §7 (thread-history view) and §8 (custom instances, DM mode) below are both built on top of the base system documented here.

Built on `@chatsift/bot-core` (§6 above), same shape as `services/ama-bot`: `bin.ts` boots with `botId: 'MODMAIL'` and `env.MODMAIL_BOT_TOKEN` (or a custom instance's decrypted token, see §8), registers its own `commands`/`components` dirs, and additionally runs four interval sweeps from `index.ts`'s `bin()` (pending-ticket abandonment, scheduled close, scheduled nuke, anti-archive — all below).

**Schema** (`packages/private/db/schema/schema.sql`) — reproduces the 9 carried-forward models from `ChatSift/ModMail`'s Prisma schema (`GuildSettings`, `Snippet`+`SnippetUpdates`, `Thread`, `ThreadMessage`, `ScheduledThreadClose`, `Block`, `ThreadOpenAlert`, `ThreadReplyAlert`) close to 1:1, plus what the ticket-system redesign added:

- `guild_settings` — `mod_forum_id` (single mod-side forum; routing is tag-based, not one-forum-per-category — an owner decision, #152), `default_greeting_message`/`farewell_message`/`alert_role_id`/`anon_reply_label` (supports a `{{ guildName }}` placeholder), `max_concurrent_threads` (default 1, guild-wide cap), `nuke_delay_minutes` (nullable — `NULL` means never auto-delete a closed ticket's private thread), `greeting_before_opener` (default false — the greeting posts after the opener message is relayed, not before), plus the `record_thread_content*`/`dm_mode` columns documented in §7/§8.
- `categories` — `name`/`emoji`/`description`/`greeting_message?` (falls back to the guild default)/`forum_tag_id?`/`sort_order`/`max_concurrent_threads?` (per-category override, must be `<= ` the guild's own limit, re-clamped defensively at read time in case the guild limit was lowered after the fact). One category per forum tag per guild (partial unique index).
- `ticket_panels` (`channel_id`, `message_id`, `panel_json_data` — raw-JSON authoring, mirroring `AMAPromptData.promptJSONData`'s precedent) + `ticket_panel_categories` join — a panel is scoped to a chosen subset of the guild's categories; a panel with zero attached categories skips the category prompt entirely.
- `threads` — `mod_thread_id` (the mod-forum post, renamed from the old Prisma model's `channel_id` since a ticket now has two Discord-channel concepts) and `user_channel_id` (nullable — a private thread for the M5 panel flow, or a DM channel id for DM mode, §8; `NULL` for migrated legacy rows), `category_id` (nullable), `origin` (`'panel' | 'dm'`, check-constrained).
- `pending_tickets` — durable record of a ticket between "private thread created" and "mod-forum thread exists," polled by `pendingTicketSweep.ts` to delete an abandoned setup (user never sent an opening message) and counted alongside real `threads` rows by the concurrency checks below so a burst of clicks can't blow past the limit before any of them resolve. Mirrored by an in-process `PendingTicketStore` (Redis, same TTL) used for routing incoming gateway events, not as the durable source of truth.
- `thread_messages`/`thread_message_content`(+`_edits`) — see §7, which added the content-recording sidecar on top of the base `thread_messages` row every relayed message and reply already gets.
- `scheduled_thread_closes` (`/close schedule`) and `scheduled_thread_nukes` (post-close deletion, gated on `nuke_delay_minutes` being set) — both polled by their own 1-minute sweeps.
- `blocks`, `thread_open_alerts`, `thread_reply_alerts`, `snippets`+`snippet_updates` — carried forward close to 1:1 from `ChatSift/ModMail`'s schema.

**API** (`services/api/src/routes/modmail/`): `config/` (get/update — the guild-settings fields above), `categories/` (CRUD), `panels/` (CRUD, incl. raw-JSON mode), `snippets/` (CRUD — `createSnippet`/`updateSnippet` mint/rename the per-guild Discord slash command directly, see below), `blocks/` (create/list/delete), `threads/` (§7), `resync.ts` (§8). Three ModMail grant strings (`modmail:snippet:create`, `modmail:config:update`, `modmail:blocks:read`) let `/snippet create`, `/config`, and `/block-list` link straight to the matching dashboard page the same way `/ama create` does — see §4a above.

**Dashboard** (`apps/website/src/app/dashboard/[id]/modmail/`): `config/`, `categories/` (+ `[categoryId]`/`new`), `panels/` (+ `[panelId]`/`new`, embed editor with a raw-JSON toggle mirroring `CreateAMAForm`'s, live preview, a `DmModeBanner` when the guild is in DM mode since panels go inert there), `snippets/` (+ `[snippetId]`/`new`), `blocks/`, `threads/` (§7).

**Create flow** (`components/createTicket.ts`, `components/categorySelect.ts`, `lib/ticketCreation.ts`): a panel's "Create Ticket" button click → deferred ephemeral reply → block check (`lib/blocks.ts`) → concurrency check (`lib/threads.ts`'s `countActiveTicketsForUser`, counting both open `threads` and in-flight `pending_tickets`) → if the panel has categories, an ephemeral category select (`buildCategorySelectOptions`, `lib/categorySelectOptions.ts`) with no thread created yet; if none, straight to thread creation. Either way: a private thread is created in the panel's channel, a `pending_tickets` row + Redis `PendingTicketStore` entry recorded, and the user told (ephemerally) to describe their issue there. The user's first message in that thread (`index.ts`'s `handleFirstMessage`, gated behind a per-guild+user lock, `lib/guildUserQueue.ts`) calls `finishTicketCreation` (`lib/ticketCreation.ts`): opens the mod-forum thread (tagged per category, if any), inserts the `threads` row, relays the opening message, and posts the category's (or guild-default) greeting — before or after the opener per `greeting_before_opener`. A ticket that never gets this far (thread created, no opening message sent) is deleted by `pendingTicketSweep.ts` after `PENDING_TICKET_TTL_MS` (30 minutes).

**Relay, both directions** (`lib/relay.ts`): user message in the private thread/DM → `relayUserMessageToModThread` (green accent, nickname-or-nothing author, media re-uploaded rather than linked — `lib/media.ts` — so attachments/stickers survive after the source is gone); staff reply → `relayStaffReplyToUserThread` (blurple, `Reply ID: N` footer mod-side only, `anon` support that resolves a templated `{{ guildName }} Team`-style label instead of the replying staffer's identity). Both directions record into `thread_message_content` when recording is enabled (§7). `/reply`, `/reply-q` (quick, no modal), and a message context-menu "Reply"/"Reply Anonymously" pair (`replyContextMenu.ts`, single-process de-dupe guard against a double-click race) all funnel into the same relay function; `/edit`/`/delete` (`lib/replyModeration.ts`) act on a prior reply by its `Reply ID: N`.

**Mention/user-ID auto-embed (#215, anti "ID swapping")** — `lib/referencedUserEmbed.ts`: scans a user's own relayed message for a Discord mention or a bare 17–20 digit snowflake, resolves each (capped at 3) against the guild, and posts a compact profile card (avatar, account-created-at, join date or "not currently a member") as a native reply to the relayed message, for every id that resolves to a real account — deliberately unconditional. **Diverges from the original design** (which called for suppressing the card when both the referenced user and the message author are staff): the schema notes explicitly rejected adding a staff-role concept (#152), and since this only ever runs on the ticket opener's own messages (staff replies are command-driven, never relayed through this path), there's no "staff flagging staff" case to suppress in the first place — every resolved id gets a card.

**Snippets** (`lib/snippets.ts`, `commands/snippet.ts`): each snippet is minted as its own per-guild Discord slash command by `services/api` on create — there's no static `CommandHandler` for these, so `index.ts`'s `registerUnknownCommandResolver` looks one up by `interaction.data.id` (`findSnippetByCommandId`) instead of dispatching through `@chatsift/bot-core`'s static command map. Supports an attachment (`snippets.attachment_url`/`attachment_filename`). `/snippet create` doesn't create one itself — it mints a grant token and links to the dashboard form (needs live slash-command-name normalization the modal flow doesn't have).

**Blocks** (`lib/blocks.ts`, `commands/block.ts`/`unblock.ts`/`blockList.ts`): dashboard- and command-managed; optional expiry (`expires_at`, relative-duration parsed via `@chatsift/parse-relative-time`). Checked as a fast pre-check before the category prompt is even shown, then re-checked authoritatively in `categorySelect.ts` immediately before a private thread is actually created.

**Close** (`commands/close.ts`, `lib/threadClose.ts`): `/close now [silent] [anon]`, `/close schedule <duration> [silent] [anon]` (writes `scheduled_thread_closes`, picked up by `scheduledCloseSweep.ts` every minute — race-safe against a manual close via `closed_at IS NULL`), `/close cancel`. Closing posts a farewell (red accent), locks the private thread (deliberately left unarchived, not deleted, so `preventThreadArchive.ts` doesn't fight it) and, if `nuke_delay_minutes` is set, schedules its actual deletion (`scheduled_thread_nukes`, polled by `threadNukeSweep.ts` every minute). The mod-forum thread is never deleted — it's the durable staff-side record.

**Other sweeps** (`index.ts`'s `bin()`, all guild-ownership-scoped per §8's `ownsGuild`/scope helpers): `preventOpenThreadsFromArchiving` (every 5 min — re-fetches both of an open ticket's Discord threads and unarchives any Discord's own inactivity timer caught; also the only place that notices a channel deleted out-of-band). `/alert` (`commands/alert.ts`) toggles a per-user ping (`thread_reply_alerts`) on new user messages in a ticket, debounced to at most one ping per 5-minute cooldown window per ticket (`lib/replyAlerts.ts`) — `ChatSift/ModMail`'s `/alert` pinged on every single relayed message instead, which turned a burst of short messages into a repeat ping per subscriber.

**Emoji forwarding** (`lib/emojis.ts`): a relayed message referencing a custom emoji the receiving guild can't render (not one of its own) gets rejected with a clear error instead of silently posting broken `<:name:id>` text — checked on every relayed user message and staff reply via a guild-emoji-id cache longer-TTL than the API's own `guildDataCache.ts` uses, since this runs far more often.

## 7. ModMail thread-history dashboard view (#261)

Shipped 2026-07-28 across three phases (DB+API+bot writer, then a frontend scaffold, then full Discord-like rendering), on top of M5's ticket/`threads` model ([06-modmail-port.md](06-modmail-port.md)). Not itself a numbered milestone — tracked as its own GitHub issue since M5 left it optional. This section is the durable shape that resulted; the phase-by-phase planning narrative, the bugs found during manual testing, and the open questions live in git history (the doc this section replaced, `07-modmail-thread-history.md`), not here.

**What it is:** a consent-gated (opt-in per guild) full transcript of every ModMail ticket — user messages, staff replies, mod-to-mod chatter posted directly in the mod-forum thread, and the bot's own greeting/farewell — recorded into Postgres as it's relayed, browsable on the dashboard with Discord-accurate rendering, edit history, and virtualized scrolling.

**Schema** (`packages/private/db/schema/schema.sql`):

- `guild_settings.record_thread_content` (default `false`) + `record_thread_content_enabled_by`/`_enabled_at` — the consent toggle and its audit trail; only (re-)stamped on the false→true transition, left as-is across a later disable.
- `thread_message_content` — 1:1 sidecar to `thread_messages` (same PK-is-FK shape as `scheduled_thread_closes`/`scheduled_thread_nukes`), holding `content`, `replied_to_thread_message_id`, `is_forwarded`, `attachments`/`stickers` (JSONB). A message with no row here predates recording (or recording was never enabled) and renders as a "not recorded" placeholder — not backfilled, not guessed.
- `thread_message_content_edits` — one row per prior version, written on each edit instead of overwriting in place (mirrors `snippet_updates`'s archive-then-overwrite pattern).
- `thread_messages` gained `is_internal` (mod-to-mod chatter posted directly in the mod-forum thread, never crosses to the user's side), `is_system` (the bot's own greeting/farewell — no real sender to attribute to `user_id`/`staff_id`), and `deleted_at` (display-only marker for a user-deleted message; the row and its content are never touched, see Decisions below). `user_message_id` is nullable to accommodate `is_internal` rows, which have no user-side counterpart.

**Bot writer** (`services/modmail-bot/src/lib`): `insertThreadMessage` (`lib/threads.ts`) takes an optional content payload and, when present, wraps the `thread_messages` insert and the `thread_message_content` insert in one transaction; JSONB columns are bound via `sql.json(...)`, not `${JSON.stringify(x)}::jsonb` (the latter double-encodes under postgres.js). `lib/relay.ts`'s two relay functions and `lib/ticketCreation.ts`/`lib/threadClose.ts`'s greeting/farewell posts all populate it when `isRecordingEnabled(guildId)`. Attachment URLs recorded are the **re-uploaded** ones off the posted message's own REST response, not the original (possibly ephemeral) source. A plain message posted directly in the mod-forum thread is captured by its own `MessageCreate` listener (`index.ts`) matched against `modThreadId` instead of `userThreadId`; `/edit`/`/delete` (staff-reply commands) and a mod editing/deleting their own plain message both keep the recorded copy in sync via dedicated `MessageUpdate`/`MessageDelete` handling (`lib/userMessageLifecycle.ts`).

**API** (`services/api/src/routes/modmail/threads/`): `listThreads`/`getThread`, both cursor-paginated (`createPaginationQuerySchema`, `services/api/src/util/schemas.ts` — the repo's first pagination pattern). `getThread` pages messages bidirectionally (`direction: before/after` over `local_thread_message_id`), defaulting to the _latest_ messages first. Shared enrichment (`routes/modmail/threads/util.ts`): resolved `APIUser`s, guild member + role names, applied forum tags, past-ticket count, sibling threads for the same user, and — for recorded rows — `resolveMessageAttachments`, which lazily heals an expired Discord CDN URL (`ex` query param) by re-fetching the still-live mod-forum message and re-matching by filename, without persisting the refresh back (a GET route stays side-effect-free; it just re-expires and heals again next time).

**Frontend** (`apps/website/src/app/dashboard/[id]/modmail/threads/`): list + two-pane detail view, `useModmailThreads`/`useModmailThread` (`api/routes/modmailThreads.ts`) as bidirectional `useInfiniteQuery`s. Rendering is `@discord/markdown-react` + `@discord/markdown-wasm` (mentions, emoji, timestamps, standard markdown) — the wasm parser breaks under Next's server bundle, so `DiscordMarkdown.tsx` is loaded via `next/dynamic(..., { ssr: false })` at every call site rather than imported directly. `ThreadMessageList.tsx` uses `@tanstack/react-virtual` with a manual scroll-anchor restore (capture `scrollHeight` before a `fetchPreviousPage`, restore the delta after — the virtualizer has no built-in notion of "this batch was prepended"). Internal mod-chatter renders visually distinct (dashed amber box, explicit "not seen by the user" label) and collapses as a block for runs of 2+; `is_system` rows get a distinct blue/sky box. An "edited" badge opens prior versions via a dedicated `getMessageEdits` route rather than inlining full history into `getThread`'s response; a "deleted" badge marks a user-deleted message whose content is still fully readable.

**Decisions worth remembering before touching this again:**

- **Deleted messages survive.** A user deleting their own message only sets `deleted_at` for display — the row and its `thread_message_content` are untouched, consistent with "the mod-forum thread is the durable record." **Internal mod-chatter is the deliberate exception**: a mod deleting their own plain message in the mod-forum thread is a true `DELETE` (cascades to its `thread_message_content`; anything that had replied to it survives with `replied_to_thread_message_id` set `NULL`) — internal notes were never part of the user-facing exchange the durable-record principle protects, so there's nothing to preserve a trace of.
- **Embeds are not recorded at all** (no `embeds` column anywhere) — an explicit, owner-approved gap, not an oversight. If a ticket ever needs one relayed with an embed captured, this needs new schema.
- **No retention/purge window.** "Recorded forever once opted in" is the accepted current behavior; a `nukeDelayMinutes`-style retention sweep for recorded content would be a follow-up, not something already half-built.
- **Roles/forum tags render live**, fetched at request time — not a point-in-time snapshot of what they were when the ticket was active.

## 8. Custom ModMail instances (#216)

Shipped 2026-07-30 across six phases, on top of M5's ticket model (§7 above). Branded, single-guild ModMail deployments for approved close partners: each is a separate Discord application, locked to one guild, run as its own `docker-compose.yml` service, sharing the main stack's Postgres/Redis/API. Optionally runs in **DM mode** (users DM the bot to open a ticket, matching pre-M5 production ModMail behavior, instead of clicking a panel button). Not itself a numbered milestone — tracked as its own GitHub issue, same as #261. This section is the durable shape; the phase-by-phase planning narrative, the owner's decision log, and the bugs found during manual testing live in git history (`docs/roadmap/08-modmail-custom-instances.md`, removed once the feature shipped), not here. The operational runbook for onboarding/offboarding a partner lives in [workflow.md](../workflow.md#custom-modmail-instances-216), not here.

**The ownership rule**, applied identically in `services/modmail-bot` and `services/api`:

> If a guild has a `modmail_instances` row, that instance owns the guild. Otherwise the public instance owns it.

`modmail_instances.guild_id` is `UNIQUE`, so "one owner per guild" is a database invariant, not a convention. The rule holds regardless of whether the public bot is also still present in the guild — deliberately, since admins leaving both bots in a guild after an onboarding is the one scenario the whole design defends against (doubling the relay or the recording would be the failure mode otherwise).

**Registry** (`packages/private/db/schema/schema.sql`'s `modmail_instances`: `id` (slug, matches the deployment's `MODMAIL_INSTANCE_ID`), `guild_id` (unique), `token` (bot token, AES-256-GCM-encrypted at rest with `ENCRYPTION_KEY` — `packages/private/backend-core`'s `encrypt`/`decrypt`, `lib/crypt.ts`), `label`. No API/dashboard CRUD exists for this table by design — a row holds a live bot credential, so it's inserted by hand (see the workflow.md runbook). `packages/private/backend-core/src/lib/instances.ts` loads it into an in-memory snapshot at boot and refreshes it every 60s (`loadInstances`/`getInstanceForGuild`/`getCustomInstanceGuildIds`/`getAllInstances`/`getSelfInstance` — the last resolved from `ENV.MODMAIL_INSTANCE_ID`, bot processes only, `null` for the API and for the public deployment) so the hot path (`apiForGuild`, called on effectively every outbound ModMail Discord call) never does a per-call DB round trip. The refresh interval is what lets onboarding a partner not require restarting the public bot — within 60s it stops acting on that guild on its own.

**What actually needed to change to support a second deployment** (both correctness-critical, not cosmetic):

- **`services/api`'s Discord calls were hardcoded to the public token.** `util/discordAPI.ts`'s `resolveGuildAPI(botId, guildId)`/`apiForGuild(botId, guildId)` resolve which token owns a `(botId, guildId)` pair — only `MODMAIL` can ever resolve to a custom instance, since custom instances are a ModMail-only concept; `AMA` always uses its single public token. Every panel/snippet/block/thread-history route, plus `channels.ts`/`roles.ts`/`emojis.ts`/`guildDataCache.ts`'s cache partitioning and `discordApplication.ts`'s per-application-id memoization, key off this instead of a single shared client, so a partner's guild (which may have only their own bot present) doesn't 403 against the wrong token.
- **The bot's sweeps queried globally with no guild filter.** `sweepAbandonedPendingTickets`/`sweepScheduledCloses`/`sweepThreadNukes`/`preventOpenThreadsFromArchiving` (`services/modmail-bot/src/lib/`) and the raw gateway message listeners (`MESSAGE_CREATE`/`UPDATE`/`DELETE`, which both bots receive if both are present in a guild) all scope now via `services/modmail-bot/src/lib/instance.ts`'s `ownsGuild(guildId)`/SQL scope fragment — two deployments polling the same shared tables would otherwise double-close tickets, double-delete private threads, or race to unarchive the same channel. Component/slash-command interactions did **not** need the same gating: they're Discord-application-scoped already (a button posted by one application is only ever dispatched to that application's gateway), so `packages/private/bot-core`'s `setGuildOwnershipFilter`/`resolveForeignOwnerLabel` (`lib/ownership.ts`) exist for defense-in-depth and correct UX on leftovers after a swap (answers "this server is served by `<label>`"), not to prevent doubling.

**Redis guild lists**: `GuildList` (`backend-core/src/lib/data/bots.ts`) keys on `bot:<BotId>`, widened to `` BotId | `${BotId}#${string}` `` — a custom deployment publishes to `bot:MODMAIL#<instanceId>` instead of the shared `bot:MODMAIL` key (two deployments overwriting the same key every 10s would flap between disjoint guild sets). `services/api/src/util/me.ts`'s `fetchMe` unions the public list with every instance's own list when deciding whether a guild has ModMail installed, and adds `customInstanceId`/`customInstanceLabel`/`customInstanceIconUrl` to `MeGuild` (branding: `label` is just the registry row, the icon comes from `applications.getCurrent()` on the instance's own token, aggressively cached — 24h in-process TTL, background refresh, redis fallback for a cold process — since `/me` is already a slow, high-traffic path). `apps/website/src/utils/bots.tsx`'s `resolveBotBranding(guild, bot)` is what the dashboard actually renders through — falls through to the static `Bots[bot]` entry whenever `customInstanceId` is `null`, so a normal guild's render path is untouched.

**DM mode** — two columns, no new tables: `guild_settings.dm_mode` (bool, only meaningful for a guild with a `modmail_instances` row; the public deployment never reads it, and the API rejects setting it `true` otherwise) and `threads.origin` (`'panel' | 'dm'`, check-constrained; pre-M5-migrated rows backfilled to `'dm'`, historically accurate since they're all closed). `threads.user_channel_id` (renamed from `user_thread_id` when DM mode landed — the old name was already misleading once a DM channel could live there too) holds either a real private-thread id or the opener's DM channel id depending on `origin`; a DM channel id is stable per `(user, bot application)`, so the existing relay/edit/delete-sync code needs **zero changes** to work for both origins — the cost is that anything which locks/archives/deletes `user_channel_id` (`threadClose.ts`'s close-time lock+nuke scheduling, `preventThreadArchive.ts`, `threadNukeSweep.ts`) must branch on `origin` first. The opener flow (`services/modmail-bot/src/lib/dmTicket.ts`): a DM with no open thread is an opener → membership/block checks → a category prompt if the guild has any (DM-mode's category list is just `categories` ordered by `sort_order`; panels/`ticket_panel_categories` are dead config in DM mode) → on pick, `finishTicketCreation` with `origin: 'dm'`, opener relayed, greeting always **after** (ignoring `greeting_before_opener`). An already-open ticket of either origin redirects instead of opening a second one (`findOpenThreadsForUser`), which is also what caps DM-mode concurrency at 1 with no dedicated enforcement code — `max_concurrent_threads` is simply never consulted by the DM path. A blocked user DMing repeatedly is rate-limited via an atomic Redis claim before the member-fetch, not just before the reply.

**Resync** (`POST /v3/guilds/:guildId/modmail/resync`, `services/api/src/routes/modmail/resync.ts`) — reconciles snippet commands and panel messages against whichever application _currently_ owns a guild, needed because Discord scopes both to the creating application: a swap orphans a snippet's guild command and a panel's message-authorship alike. Deliberately a manual dashboard button (shown for custom-instance guilds and global admins), not automatic on every registry refresh — ownership can flap (a row edited twice in quick succession, a bad deploy rolled back), and reposting every panel on every refresh tick would be wasteful and could repost panels that never needed it. The detection trick needs no memory of which application _used to_ own the guild: a stale snippet command 404s (`UnknownApplicationCommand`) when looked up under the current owner, since command ids are application-scoped; a stale panel message fails to edit (`CannotEditMessageAuthoredByAnotherUser`, or `UnknownMessage` if it's gone) under the current owner, since only the authoring application can edit it. A command under the current application not backing any live snippet is deleted as an orphan; a repost reads the button's label back off the still-live message first (`panel_json_data` never stored it), falling back to a default if the message is gone entirely.

**A real asymmetry between onboarding and offboarding**, worth remembering before "simplifying" this into one button: resync always targets whichever application the registry says _currently_ owns the guild. Onboarding only ever needs one resync call (the row already points at the new partner by the time it runs). **Offboarding needs two** — once before deleting the `modmail_instances` row (so the partner's application can still clean up what it can reach), and once after (now that the guild resolves back to public, to actually recreate/repost onto it). See the workflow.md runbook for the full ordered sequence.

## 9. Terms, Privacy Policy & Discord compliance (#263)

A compliance pass against Discord's Developer Terms of Service/Developer Policy, prompted by the fact that neither
a Terms of Service nor a Privacy Policy existed anywhere on `automoderator.app` before this. Scoped down from a
broader audit to the items the owner confirmed were real gaps — see #263 for the full audit (data
inventory, retention posture, everything considered and explicitly _not_ actioned, and why).

**What shipped:**

- **`/terms` and `/privacy` pages** (`apps/website/src/app/terms/`, `.../privacy/`), linked from `Footer.tsx`.
  Plain static content pages, `LegalSection` (`components/marketing/LegalSection.tsx`) is the only shared piece —
  a heading + body wrapper so the pages read as plain semantic HTML instead of hand-styling every paragraph/list.
  Privacy Policy content reflects actual current behavior, not aspirational policy: data is retained indefinitely
  while a server has the bot configured (no purge timer — the dashboard's historical views, e.g. past AMA
  sessions and ModMail thread history §7, are an intentional ongoing record staff rely on, not a queue to be
  drained), and deletion/access requests are handled manually by reaching out on the support server rather than a
  self-service flow.
- **Dropped the unused `email` OAuth scope** (`services/api/src/routes/auth/discord.ts`'s `DISCORD_AUTH_SCOPES`) —
  it was requested but never read anywhere in `services/api` or `apps/website`; data minimization, not a feature
  change. `identify`/`guilds`/`guilds.members.read` are unaffected. Existing sessions issued under the old scope
  set keep working; only new logins get the narrower grant.
- **Discord OAuth tokens are now encrypted, not just signed, inside session JWTs** (`services/api/src/util/tokens.ts`,
  `middleware/isAuthed.ts`): `discordAccessToken`/`discordRefreshToken` are wrapped with the same
  `encrypt`/`decrypt` (`packages/private/backend-core/src/lib/crypt.ts`, AES-256-GCM) already used for
  `modmail_instances.token`, applied only at the sign/verify boundary — every downstream reader (`me.ts`,
  `logout.ts`, the guild-manager check, the refresh flow) still sees plaintext and needed no changes. Closes a real
  gap: a JWT is only base64-encoded, not encrypted, by default, so the raw Discord credentials were previously
  readable from a leaked `refresh_token` cookie or `X-Update-Access-Token` header value without needing to break
  the signature.
- **Redis runs fully in-memory** (`docker-compose.yml`'s `redis` service: `--save '' --appendonly no`) — nothing
  in the stack treats it as a source of truth (`GuildList`/instance snapshots republish on an interval,
  `PendingTicketStore` mirrors the durable `pending_tickets` table, grant-token claims are best-effort), so there
  was no reason for it to write RDB/AOF snapshots to disk at all. Removes it from the at-rest-encryption scope
  entirely instead of needing the same treatment as Postgres, and drops the fsync/bgsave overhead as a side effect.
- **Improved the 404 page** (`apps/website/src/app/not-found.tsx`) — was a single line of text plus a client-only
  "Go back" button; now also offers a plain `Link`-based "Return home" (works even before the client bundle
  hydrates) alongside the existing back button.

**Explicitly considered and not actioned** (owner calls, not oversights — don't re-litigate without new
information):

- **No retention/purge window for AMA questions or ModMail transcripts.** The dashboard surfaces full history for
  essentially every table; there's no data that can be honestly argued as "no longer necessary" while that
  remains true. Would need revisiting only if a feature that depends on that history goes away.
- **No self-service data-deletion flow.** The support-server-contact path in the Privacy Policy is the actual
  process, not a placeholder for a future build.
- **No cleanup when a bot leaves a guild or a user's data becomes orphaned.** Standard bot behavior — data has to
  survive a re-invite for settings to still be there, same as every other Discord bot.
- **No custom-ModMail-instance Terms addendum.** Considered because partner deployments (§8 above) share
  ChatSift's Postgres/Redis, but ChatSift owns the Discord application on every instance (including branded
  ones) — there's no separate data controller relationship to document.
- **Postgres at-rest disk encryption** (Developer Terms §5(c)) is real but is a host-level change (`fscrypt` on
  the production VPS), not something achievable from this repo — runbook is in
  [workflow.md](../workflow.md#encryption-at-rest-263), execution is on the operator, not tracked as "shipped"
  here.
