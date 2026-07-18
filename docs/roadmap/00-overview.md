# ChatSift Rebirth — Overview

> Entry point for humans and LLM agents working on the ChatSift rebirth. Read this first, then follow the links below for the area you're touching.

## What ChatSift is

ChatSift (automoderator.app) is a Discord bot suite with three products:

- **AutoModerator** — day-to-day moderation bot.
- **AMA** — Ask-Me-Anything event management (question submission, mod/guest review queues, publishing answers).
- **ModMail** — DM-to-staff-thread relay for user inquiries.

All three have (or had) real production deployments and live user data.

## Corrected product history

This history was previously misunderstood in early planning — it is captured here precisely so it doesn't get re-litigated.

- **`ChatSift/chatsift`** (this repo) was originally **`ChatSift/AutoModerator`**. It was renamed once the decision was made to put all bots into a single monorepo.
- **`v1` branch** — the original AutoModerator codebase, archived 2022. Historical only.
- **`v2` branch** — an AutoModerator overhaul. **This shipped and is still running in production today.** AutoModerator is **out of scope** for the beginning stage described in this doc set — it already works, it isn't being touched.
- **`ChatSift/AMA`** (separate repo) — AMA's production codebase. Prisma + Postgres. Still deployed and serving real Discord servers today.
- **`ChatSift/ModMail`** (separate repo) — ModMail's production codebase. Prisma + Postgres. Still deployed and serving real Discord servers today.
- **`main` branch** (this repo, this doc set's subject) — the current, furthest-along attempt at consolidating AMA + ModMail (+ eventually AutoModerator) into one monorepo with a shared dashboard. Several earlier rebirth attempts stalled; this one has the architecture worth keeping and finishing.

So: **AutoModerator lives on, unchanged, on `v2`.** **AMA and ModMail live in their own prod repos and are being ported into `main`.** This doc set is about finishing that port for AMA and ModMail.

## Why now / what's being fixed

Two concrete problems motivated this rebirth push, both explained in depth in the ADRs:

1. `main`'s **API contract pattern** between `services/api` and `apps/website` looked type-safe but wasn't — see [ADR 0001](../adr/0001-api-contract-pattern.md). Fixed as of M1.
2. `main`'s **database layer** (Prisma + Kysely) worked but wasn't the preferred raw-SQL style and had no first-class down migrations — see [ADR 0002](../adr/0002-db-stack.md). Fixed as of M1: Prisma/Kysely are gone, replaced by `postgres.js` + Atlas + kanel (`packages/db`).

Both are being fixed via **refactor, not rewrite** — the underlying stack (polka, zod, TanStack Query, Next.js App Router) stays. See [01-architecture.md](01-architecture.md) for the full before/after picture.

## Reference architecture

`/Users/didinele/Documents/Work/didinele/SimplyChords` (private repo, `didinele/SimplyChords`) is the pattern being adopted for both the API contract and the DB layer. It uses the same base stack as this repo (polka + zod + @hapi/boom + TanStack Query + Next App Router + Jotai) but with a clean functional API contract (`defineRoute`/`InferRouteContract`) and a `porsager/postgres` raw-SQL data layer. Its auth scheme is already nearly identical to this repo's. Concrete file references are in the architecture doc and ADRs.

## Beginning-stage definition of done

The "beginning stage" is complete when all three are true:

1. **A solid dashboard-config-first website** is running on the new API-contract + DB-stack pattern (no marketing site — deferred indefinitely, see [03-dashboard-config.md](03-dashboard-config.md)).
2. **AMA is fully running** on the new stack, covering all four feature clusters (full question pipeline, answer-publishing polish, analytics & export, in-Discord slash commands — see [04-ama-complete.md](04-ama-complete.md)), and production traffic has been cut over from `ChatSift/AMA` via a **drain-and-swap** (no data migration — see [05-migration-cutover.md](05-migration-cutover.md)).
3. **ModMail is ported** to the new monorepo, including a **real data migration** of threads/messages/snippets/blocks from `ChatSift/ModMail` (see [06-modmail-port.md](06-modmail-port.md)).

AutoModerator is explicitly **not** part of this stage.

## Setting up the GitHub side (milestones/labels/issues)

M0 also included creating GitHub milestones, labels, and seed issues for this roadmap. This wasn't automated — commands were handed to the user to run (see Working conventions in [CLAUDE.md](../../CLAUDE.md)), not tracked in a standalone doc. Done: M0–M5 milestones and the `area:*`/`type:*` labels exist; M0's own seed issues (roadmap docs, ADRs, GitHub setup, prod schema discovery) were backfilled and closed after the fact since the work predated issue tracking.

## Milestone map

| Milestone                      | Doc                                                | Target (from 2026-07-16, ~7 hrs/wk) | Status            |
| ------------------------------ | -------------------------------------------------- | ----------------------------------- | ----------------- |
| M0 — Scaffolding & discovery   | this doc set + GitHub setup                        | ~2026-07-23                         | Done (2026-07-16) |
| M1 — Foundation refactor       | [02-foundation.md](02-foundation.md)               | ~2026-08-20                         | Done (2026-07-17), milestone closed |
| M2 — Dashboard-config solid    | [03-dashboard-config.md](03-dashboard-config.md)   | ~2026-09-17                         | Done (2026-07-18), milestone closed |
| M3 — AMA fully running         | [04-ama-complete.md](04-ama-complete.md)           | ~2026-11-05                         | In progress — Cluster 1 (question pipeline) done; Cluster 2 (slash-command infra) done, command set in progress (#143); Clusters 3–4 not started |
| M4 — AMA drain-and-swap (live) | [05-migration-cutover.md](05-migration-cutover.md) | ~2026-11-19                         | Not started       |
| M5 — ModMail port + migrate    | [06-modmail-port.md](06-modmail-port.md)           | ~2027-01-mid                        | Not started       |

Dates are targets, not commitments — capacity is ~5–10 hrs/wk. M2 and M3 can interleave.

## Glossary

- **Contract / API contract** — the shared type surface between `services/api` and `apps/website` describing each route's method, path, body/query, and response shape.
- **`defineRoute`** — the SimplyChords-style factory that defines a route and lets TypeScript infer its contract from the handler, replacing this repo's `Route` class.
- **`InferRouteContract<T>`** — the type-level bridge that turns a `defineRoute(...)` object into `{ body, query, params, response, method, path }` for the frontend.
- **Drain-and-swap** — the AMA cutover strategy: disable new-AMA creation on the old production bot, let in-flight AMAs finish naturally, then deploy the new bot. No data migration involved.
- **Cutover** — the moment production traffic/token is pointed at the new deployment.
- **Kanel** — a tool that introspects a Postgres database and generates matching TypeScript row types.
- **Atlas** — a schema-as-code migration tool (`ariga/atlas`) that diffs a declarative schema against migration history to auto-generate versioned up/down SQL migrations.

## Where things live

- This repo: `/Users/didinele/Documents/Work/ChatSift/ChatSift` (GitHub: `ChatSift/chatsift`).
- Reference repo: `/Users/didinele/Documents/Work/didinele/SimplyChords` (GitHub: `didinele/SimplyChords`, private).
- Old AMA prod: `ChatSift/AMA`.
- Old ModMail prod: `ChatSift/ModMail`.
- Live AutoModerator prod: `v2` branch of this repo.
