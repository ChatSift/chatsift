# ChatSift Rebirth — Overview

> Entry point for humans and LLM agents working on the ChatSift rebirth. Read this first, then follow the links below for the area you're touching.

## What ChatSift is

ChatSift (automoderator.app) is a Discord bot suite with three products:

- **AutoModerator** — day-to-day moderation bot.
- **AMA** — Ask-Me-Anything event management (question submission, mod/guest review queues, publishing answers).
- **ModMail** — staff-thread relay for user inquiries. Prod (`ChatSift/ModMail`) is DM-based; the in-repo rebuild ([06-modmail-port.md](06-modmail-port.md), redesigned 2026-07-22) replaces the DM origin with an in-server private-thread ticket flow — the mod-side experience is unchanged.

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

1. **A solid dashboard-config-first website** is running on the new API-contract + DB-stack pattern (no marketing site — deferred indefinitely). Done as of M2 (2026-07-18).
2. **AMA is fully running** on the new stack, covering all four feature clusters (full question pipeline, answer-publishing polish, analytics & export, in-Discord slash commands). Done as of M3 (2026-07-19); production traffic cutover from `ChatSift/AMA` via a **drain-and-swap** (no data migration) is M4, in progress — see [05-migration-cutover.md](05-migration-cutover.md).
3. **ModMail is ported** to the new monorepo, including a **real data migration** of threads/messages/snippets/blocks from `ChatSift/ModMail` (see [06-modmail-port.md](06-modmail-port.md)).

AutoModerator is explicitly **not** part of this stage.

## Setting up the GitHub side (milestones/labels/issues)

M0 also included creating GitHub milestones, labels, and seed issues for this roadmap. This wasn't automated — commands were handed to the user to run (see Working conventions in [CLAUDE.md](../../CLAUDE.md)), not tracked in a standalone doc. Done: M0–M5 milestones and the `area:*`/`type:*` labels exist; M0's own seed issues (roadmap docs, ADRs, GitHub setup, prod schema discovery) were backfilled and closed after the fact since the work predated issue tracking. The M4/M5 milestone due dates and several issue bodies are now stale against the 2026-07-22 redesign (M4's real dates, M5's ticket-model rebuild) — commands to bring them in line were handed to the user the same way, not automated.

## Milestone map

| Milestone                      | Doc                                                                       | Target                                                                            | Status                                                                       |
| ------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| M0 — Scaffolding & discovery   | git history + GitHub setup                                                 | ~2026-07-23                                                                          | Done (2026-07-16)                                                                  |
| M1 — Foundation refactor       | git history (spec doc removed once done; see [01-architecture.md](01-architecture.md)) | ~2026-08-20                                                                          | Done (2026-07-17), milestone closed                                               |
| M2 — Dashboard-config solid    | git history (spec doc removed once done)                                   | ~2026-09-17                                                                          | Done (2026-07-18), milestone closed                                               |
| M3 — AMA fully running         | git history (spec doc removed once done; see [01-architecture.md §6](01-architecture.md#6-ama-bot-subsystem-servicesama-bot)) | ~2026-11-05 | Done (2026-07-19), issues closed, GitHub milestone still open (closing it is a write action, left to the user) |
| M4 — AMA drain-and-swap (live) | [05-migration-cutover.md](05-migration-cutover.md)                        | **2026-08-03** (kill-switch) / **2026-08-08** (cutover) — public commitments, not estimates | In progress — Canary deployed 2026-07-22                                          |
| M5 — ModMail rebuild + migrate | [06-modmail-port.md](06-modmail-port.md)                                  | TBD — rescope after the 2026-07-22 redesign                                          | Not started; redesigned as a ticket/private-thread system, not a straight DM-based port |

M1–M3's per-milestone spec docs (`02-foundation.md`, `03-dashboard-config.md`, `04-ama-complete.md`) were removed once each milestone shipped — durable architecture knowledge from them now lives in [01-architecture.md](01-architecture.md) and [workflow.md](../workflow.md); planning detail is in git history if ever needed. M4's dates come from a public Discord announcement, not a capacity estimate. M5 was fundamentally redesigned on 2026-07-22 — see that doc for why.

## Glossary

- **Contract / API contract** — the shared type surface between `services/api` and `apps/website` describing each route's method, path, body/query, and response shape.
- **`defineRoute`** — the SimplyChords-style factory that defines a route and lets TypeScript infer its contract from the handler, replacing this repo's `Route` class.
- **`InferRouteContract<T>`** — the type-level bridge that turns a `defineRoute(...)` object into `{ body, query, params, response, method, path }` for the frontend.
- **Drain-and-swap** — the AMA cutover strategy: disable new-AMA creation on the old production bot, let in-flight AMAs finish naturally, then deploy the new bot. No data migration involved.
- **Cutover** — the moment production traffic/token is pointed at the new deployment.
- **Kanel** — a tool that introspects a Postgres database and generates matching TypeScript row types.
- **Atlas** — a schema-as-code migration tool (`ariga/atlas`) that diffs a declarative schema against migration history to auto-generate versioned up/down SQL migrations.
- **Grant token** — a short-lived, single-use JWT a bot slash command mints to authorize one dashboard action without a browser session; see [01-architecture.md §4a](01-architecture.md#4a-grant-token-auth-one-time-scoped-194).
- **Ticket panel** — a staff-configured embed+button (ModMail, M5) that opens a private thread for the clicking user; the new-ModMail equivalent of AMA's prompt message.
- **Canary** — `AMA Canary`, the publicly-invitable pre-cutover deployment of the new AMA stack (client ID `1427232824854970409`), live 2026-07-22 through the M4 cutover.

## Where things live

- This repo: `/Users/didinele/Documents/Work/ChatSift/ChatSift` (GitHub: `ChatSift/chatsift`).
- Reference repo: `/Users/didinele/Documents/Work/didinele/SimplyChords` (GitHub: `didinele/SimplyChords`, private).
- Old AMA prod: `ChatSift/AMA`. Pre-cutover new-stack deployment: `AMA Canary` (client ID `1427232824854970409`).
- Old ModMail prod: `ChatSift/ModMail`.
- Live AutoModerator prod: `v2` branch of this repo.
