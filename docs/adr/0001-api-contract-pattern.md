# ADR 0001: Replace the `Route` class contract with `defineRoute`

- **Status:** Accepted, implemented in M1 (2026-07-17)
- **Date:** 2026-07-16
- **Related:** [01-architecture.md](../roadmap/01-architecture.md) (current state)

## Problem

`main`'s API contract between `services/api` and `apps/website` is built from three cooperating pieces:

1. An abstract `Route<TResult, TBodyOrQueryZodType>` class (`services/api/src/routes/route.ts`) that every endpoint subclasses, carrying a phantom field purely to smuggle generics through:
   ```ts
   public readonly __internalOnlyHereForTypeInferrenceDoNotUse__!: {
     bodyOrQuery: z.infer<TBodyOrQueryZodType>;
     result: TResult;
   };
   ```
2. Type-level reflection over the route classes' **value exports** (`services/api/src/routes/routes.ts` re-exports classes as values; `services/api/src/routes/_types/routeTypes.ts` reflects over `typeof routes` to build `RoutesByClass` → `RoutesByPath` → `APIRoutes`).
3. A **hand-maintained mirror** on the frontend (`apps/website/src/data/common.ts`'s `routesInfo` object) duplicating every route's path string, params, and query shape, used to build fetches and react-query keys.

### Why this is a real problem, not just ugly

- **Multiple sources of truth.** A route's path/params/query is declared in the `Route` subclass's `info`, _and_ separately by hand in `routesInfo`. Path strings (e.g. `/v3/guilds/:guildId/ama/amas`) must be character-identical between the two or the `Narrow<...>` type utility silently resolves to `never` — a typo doesn't error loudly, it just erases the type.
- **Adding one endpoint touches ~6 files:** the route file, `routes.ts`, `_types/index.ts`, `common.ts`, `client.tsx`, and often `server.ts`.
- **The inference doesn't actually hold at the call sites.** Both `apps/website/src/data/client.tsx` and `data/server.ts` contain:
  ```ts
  // @ts-expect-error - This won't ever compile
  const data = (await fetcher()) as Promise<InferAPIRouteResult<Options['path'], 'GET'> | null>;
  ```
  and
  ```ts
  // @ts-expect-error - We can't get it to compile on the Method
  InferAPIRouteResult<Options['path'], Method>,
  ```
  So the elaborate generic machinery (`ParseHTTPParameters`, `InferRouteResult`, `ConstructorToType`, `Narrow`) is defeated by casts at the exact points where it's supposed to deliver value. You pay the complexity cost without the safety guarantee.
- **A route can't validate both body and query.** The single `TBodyOrQueryZodType` generic means `register()` literally `throw`s if both `bodyValidationSchema` and `queryValidationSchema` are set — a runtime check standing in for a type constraint.
- **Frontend build is coupled to backend build.** The website typechecks against `@chatsift/api`'s compiled `dist/index.d.ts`, so the API must build first, and the "contract" is really just importing the backend's internal types wholesale.
- **Duplicated fetch/token logic.** Client (`data/client.tsx`) and server (`data/server.ts`) reimplement fetching, access-token-rotation-header handling, and path substitution independently, with two different token stores (`useState` on the client, a module-level `Map` on the server) — easy to let drift.

## Options considered

| Option                                                        | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status quo, just remove the casts**                         | Not viable — the casts exist _because_ the inference doesn't hold across the method/path indirection; removing them without redesigning the type flow just breaks the build.                                                                                                                                                                                                                                                                                                          |
| **tRPC**                                                      | Would give real end-to-end inference, but requires restructuring `services/api` around tRPC's router/procedure model — a bigger-than-necessary framework swap for what's fundamentally a typing problem, and it doesn't naturally fit polka's existing route-per-file layout.                                                                                                                                                                                                         |
| **ts-rest**                                                   | Contract-first, close to what's wanted, but introduces a separate contract-definition DSL and package layer that duplicates work already achievable with plain TypeScript generics.                                                                                                                                                                                                                                                                                                   |
| **OpenAPI + codegen**                                         | Adds a build step (spec generation + client codegen) for a monorepo where frontend and backend already share a TypeScript boundary — unnecessary indirection.                                                                                                                                                                                                                                                                                                                         |
| **`defineRoute` factory (SimplyChords pattern)** — **chosen** | A functional factory whose only job is to preserve literal/inferred generics (method, path, body, query, params, response inferred from the handler's return type). No phantom fields, no reflection over value exports, no separate DSL. The API package is consumed by the frontend as a **type-only workspace dependency** (`devDependency`, `import type` only) — zero extra runtime, zero client bundle cost, and the "contract" is just `InferRouteContract<typeof someRoute>`. |

## Decision

Adopt the SimplyChords `defineRoute` / `InferRouteContract` pattern, detailed with code in [01-architecture.md](../roadmap/01-architecture.md). Concretely:

- Replace `services/api/src/routes/route.ts`'s `Route` class with `services/api/src/core/route.ts`'s `defineRoute` factory + `defineMiddleware` for typed middleware context (`req.identity` etc. via a `UnionToIntersection` merge over declared middleware).
- Replace `routes.ts` + `_types/*` with a single `services/api/src/core/contract.ts` (`InferRouteContract`) and a type-only `services/api/src/index.ts` that re-exports route objects + their zod schemas (so the frontend can reuse the same schema for form validation).
- Delete `apps/website/src/data/{common,client,server}.tsx` and `utils/fetcher.tsx`; replace with `apps/website/src/api/{fetch,queryClient,error,token}.ts` (isomorphic `apiFetch` that branches on `typeof window`) + one `apps/website/src/api/routes/<resource>.ts` file per resource exporting hooks and prefetch-friendly `{ queryKey, queryFn }` objects, with all types derived via `InferRouteContract<typeof route>` — no hand-mirrored path registry.
- A `mountRoute(route)` pipeline (`services/api/src/core/server.ts`) replaces `Route.register()`: conditionally parses JSON, validates body/query/params via the route's zod schema (throwing a Boom 400 with `error.issues` on failure), runs the route's middleware, then serializes the handler's return (200 + JSON, or 204 for `undefined`/`null`) — removing the repeated manual `res.statusCode = 200; res.setHeader(...); res.end(JSON.stringify(...))` boilerplate from every handler.

## Consequences

- **Positive:** one source of truth per route (the `defineRoute` call); real compiler-enforced end-to-end types with zero `@ts-expect-error`; adding an endpoint touches 2 files (the route file + its one-line re-export in `index.ts`) instead of ~6; body+query+params can all be validated on the same route; response schemas can be reused for docs/validation later if wanted.
- **Negative / accepted tradeoffs:** the response contract is inferred from the handler's _return type_, not runtime-validated against `schema.response` (matching SimplyChords — the response schema is documentation + type source, not a runtime gate; can be added later if desired). Path strings are still passed as literal strings to `apiFetch` on the frontend (not structurally checked against `route.path`) — same residual risk as today, but isolated to one call site per hook instead of a whole mirrored registry.
- **Migration cost:** all ~13 existing routes (5 AMA, 4 auth, 4 guilds) needed porting; done in M1 (#128–130) — see [01-architecture.md](../roadmap/01-architecture.md) §1.
