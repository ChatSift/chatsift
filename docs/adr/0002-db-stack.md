# ADR 0002: Replace Prisma+Kysely with porsager/postgres + Atlas + kanel

- **Status:** Accepted
- **Date:** 2026-07-16
- **Related:** [01-architecture.md](../roadmap/01-architecture.md), [02-foundation.md](../roadmap/02-foundation.md)

## Problem

`main` uses **Prisma** purely as a schema/migration tool (`prisma/schema.prisma`, `prisma migrate`) with a `prisma-kysely` generator producing types consumed by the **Kysely** query builder at runtime. This works today, but:

- Schema authoring is locked to Prisma's DSL.
- Prisma migrations are **forward-only in practice** — generating a down migration requires manually running `migrate diff` against the previous schema and applying it with `db execute`; it's not a first-class, automatic capability.
- The preferred query style going forward is **raw SQL**, not a query builder — matching the reference architecture (SimplyChords) and the owner's stated preference.

## Requirements

1. Raw SQL as the primary query style, with the `porsager/postgres` driver specifically (the npm package is literally named `postgres` — "postgres.js" is its common nickname, not a different library).
2. Auto-generated migrations from a schema source of truth (not hand-written SQL migration files from scratch every time).
3. First-class down-migration support.
4. Generated TypeScript types so raw SQL results aren't manually typed from scratch.

## Options considered

| Option | Runtime | Migrations | Down migrations | Types | Verdict |
|---|---|---|---|---|---|
| **Prisma 7 + TypedSQL** | Prisma Client, or typed raw SQL from `.sql` files via TypedSQL (GA in Prisma 7) | `prisma migrate` (schema DSL) | Manual (`migrate diff` + `db execute`) | TypedSQL generates result types per `.sql` file | Least churn from today, but keeps the Prisma DSL (the thing being moved off) and down migrations stay manual. Rejected. |
| **Drizzle** | Drizzle query builder, `sql\`\`` escape hatch for raw | `drizzle-kit generate` auto-diffs a **TypeScript schema** into SQL migrations | **Not built-in** — forward-only; down migrations would be hand-written | Inferred directly from the TS schema, no separate codegen step | Excellent single-tool ergonomics and genuinely auto-generates forward migrations, but is query-builder-first (raw SQL is the escape hatch, not the default) and fails requirement 3 outright. Rejected. |
| **postgres.js + Atlas + pgTyped** | `porsager/postgres`, raw SQL | Atlas: declarative schema → `atlas migrate diff` auto-generates versioned SQL, `atlas migrate down` reverts | **Yes**, first-class | pgTyped parses each hand-written SQL query and infers its exact result type — zero hand-annotation | Fullest type safety per query, but more setup/ceremony per query (a build step per `.sql` or tagged query) and a less mature TS ecosystem footprint than kanel. Noted as a future upgrade. |
| **postgres.js + Atlas + kanel** — **chosen** | `porsager/postgres`, raw SQL | Atlas (same as above) | **Yes**, first-class | kanel introspects the live DB schema and generates matching row types (tables/columns), used to annotate `sql<Row[]>\`...\`` results | Meets all four requirements. kanel's types are schema-level (you annotate `sql<T>` yourself) rather than per-query-inferred, which is a small ergonomics tradeoff against pgTyped, but is simpler, more mature, and is exactly the mechanism the reference architecture (SimplyChords) documents as viable alongside postgres.js. |

## Decision

Adopt **`porsager/postgres` (raw SQL) + Atlas (schema + versioned migrations, with real down support) + kanel (generated row types)**, packaged as a new `packages/db` workspace mirroring SimplyChords' `@simplychords/db` shape but with Atlas in place of `ley` (SimplyChords uses `ley` for hand-written migrations; Atlas adds the auto-diff + down-migration capability this project specifically wants).

- **Schema of record:** a declarative schema owned by `packages/db` (Atlas HCL or plain SQL — finalized during M1 implementation), reproducing the current 6 Prisma models as the starting point (see [01-architecture.md](../roadmap/01-architecture.md) §5).
- **Migrations:** `atlas migrate diff --dir file://migrations --to file://schema.sql` (or HCL equivalent) generates versioned migrations on every schema change; `atlas migrate apply` runs them; `atlas migrate down` reverts; `atlas migrate lint` runs in CI to catch destructive changes before merge.
- **Types:** `kanel` runs against a migrated database (dev or CI) and writes generated row types into `packages/db/src/generated/`, committed or regenerated in CI — decided during M1.
- **Runtime:** `container.db` (on `getContext()`) is a `postgres()` client instance; queries are `container.db<RowType[]>\`SELECT ...\``.

## Consequences

- **Positive:** real down migrations; schema authoring is plain SQL/HCL instead of a proprietary DSL; raw SQL matches the preferred style; CI can lint migrations for destructive changes before they ship.
- **Negative / accepted tradeoffs:**
  - **Atlas is a Go binary**, an external dependency in local dev and CI (not an npm package). Acceptable given the down-migration and auto-diff requirements; if it proves too heavy, a lighter SQL-migration runner (e.g. `node-pg-migrate`, `dbmate`) is a fallback but loses auto-diff and would make down migrations hand-written again.
  - **kanel gives schema-level types, not per-query inference** — a `sql<Row[]>` call is only as correctly typed as the row type you pick; a typo'd column selection wouldn't be caught the way pgTyped would catch it. If this friction becomes real during M1/M3, upgrading to pgTyped or `ts-safeql` for hot-path queries is a reversible, incremental follow-up — not a blocker now.
  - **Migration effort:** the existing `prisma/schema.prisma` (6 models) and its generated Kysely usage across ~13 routes and the `ama-bot` service all need porting. Tracked in [02-foundation.md](../roadmap/02-foundation.md).
