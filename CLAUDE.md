# CLAUDE.md

This file orients Claude Code (or any LLM agent) working in this repo.

## Start here

This repo is mid-rebirth. **Read [docs/roadmap/00-overview.md](docs/roadmap/00-overview.md) first** — it has the corrected product history (this repo was `ChatSift/AutoModerator`; AutoModerator itself now lives unchanged on the `v2` branch; AMA and ModMail are being ported in from their own separate production repos `ChatSift/AMA` and `ChatSift/ModMail`), the current beginning-stage goal, and links to every other doc.

Full doc set:

- [docs/roadmap/00-overview.md](docs/roadmap/00-overview.md) — history, glossary, milestone map. Read first.
- [docs/roadmap/01-architecture.md](docs/roadmap/01-architecture.md) — current architecture with code excerpts (API contract, DB stack, AMA bot subsystem, ModMail bot subsystem).
- [docs/adr/0001-api-contract-pattern.md](docs/adr/0001-api-contract-pattern.md) — why the API contract pattern was replaced (implemented, M1).
- [docs/adr/0002-db-stack.md](docs/adr/0002-db-stack.md) — why the DB stack was replaced (implemented, M1).
- [docs/roadmap/05-migration-cutover.md](docs/roadmap/05-migration-cutover.md) — M4, AMA drain-and-swap cutover (in progress).
- [docs/roadmap/06-modmail-port.md](docs/roadmap/06-modmail-port.md) — M5, ModMail: feature work shipped, only the legacy data migration + cutover remain.
- [docs/workflow.md](docs/workflow.md) — branching, commits, local dev, verification standard.
- [docs/frontend.md](docs/frontend.md) — `apps/website` conventions: theme tokens, component library, forms, data fetching. Read before writing UI code.

M1–M3 (foundation refactor, dashboard polish, AMA feature-complete) are done and their per-milestone spec docs have been removed; durable architecture knowledge from them lives in 01-architecture.md and workflow.md now. Git history has the specs if you need the original planning detail. The ModMail dashboard thread-history view (#261) shipped the same way — its spec doc is gone, durable shape now lives in [01-architecture.md §7](docs/roadmap/01-architecture.md#7-modmail-thread-history-dashboard-view-261). Custom ModMail instances (#216, branded single-guild deployments + DM front door) shipped the same way too — durable shape is [01-architecture.md §8](docs/roadmap/01-architecture.md#8-custom-modmail-instances-216), the operational runbook is in [docs/workflow.md](docs/workflow.md#custom-modmail-instances-216).

## Quick facts

- Yarn 4 (Berry) workspaces + Turborepo monorepo, ESM, TypeScript strict.
- `apps/website` — Next.js App Router dashboard. `services/api` — polka HTTP API. `services/ama-bot`/`services/modmail-bot` — gateway Discord bots. `packages/private/{core,backend-core,bot-core}` — shared code.
- **This repo is being actively refactored** — M1 (foundation refactor) landed 2026-07-17, so the ADRs' "current/being replaced" framing is historical, not the present state; [01-architecture.md](docs/roadmap/01-architecture.md) has the actual current shape. Check the actual code first regardless — docs describe intent and rationale, not necessarily the exact present-moment state if work has progressed since a doc was last updated.
- Commands: `yarn build`, `yarn lint`, `yarn test`, `yarn format:check` — all four are per-package turbo tasks, so repeat runs are cache hits. Commit messages are commitlint-enforced (angular config) — see [docs/workflow.md](docs/workflow.md).
- Reference architecture for the API contract + DB patterns: `/Users/didinele/Documents/Work/didinele/SimplyChords` (private repo, local path only — not fetchable by URL).

## Engineering principles

- Choose the simplest implementation that fully meets the current requirements. Avoid speculative abstractions, configuration, and indirection.
- Grow the system in layers. Start from the smallest version that works end to end, and add each new capability on top of something that already works. Never trade a working product for unfinished complexity — this repo already works this way, see the P1/P2/P3-style phasing on #216 and #343.
- Keep components modular and concerns clearly separated.
- Lean on the dependencies already in the project before writing your own implementation. Do not assume a library lacks a capability without checking its documentation and types. Before writing a new util, **grep the repo for an existing one** — unused code is still findable code.
- Adding a _new_ package is a judgment call, not a default. Prefer an established, well-maintained library over a hand-rolled one when it genuinely reduces complexity or improves reliability — but this stack has repeatedly chosen zero-dependency solutions that reuse existing infra (see #270's rationale in [docs/workflow.md](docs/workflow.md#query-performance-tracking-270)). Say why a new dependency earns its place.
- Make architectural decisions for the long term. Do not accept a stopgap that only works for now and is meant to be replaced later.
- Match the codebase's comment culture: substantial "why" comments referencing the issue number that motivated the code (`#216`, `#295`, `#335`), not restatements of what the line does.

## Working conventions

- Follow [docs/workflow.md](docs/workflow.md) for branching/commits/verification. **The verification split matters:** an agent's job is `yarn build`, `yarn lint`, `yarn test`, `yarn format:check` green plus whatever else it can genuinely check. Runtime verification of Discord and dashboard behaviour is the user's — an agent has no Discord connection and no session, so the most it can do against a locally-running API is confirm a route is mounted and returns 401 rather than 404. Never claim a feature "works"; state what you verified and what you left for the user to exercise.
- AutoModerator (`v2` branch) is out of scope for all work described in `docs/roadmap/` — it's a separate, already-shipped product.
- **Never run `git commit` or any GitHub write action (creating milestones/labels/issues/PRs, etc.) on the user's behalf.** Do the analysis/content work, leave changes staged or written to disk, and hand back exact commands or a step-by-step instruction doc for the user to run themselves. Read-only `gh`/`git` inspection is fine.

## Frontend (`apps/website`)

Full conventions in [docs/frontend.md](docs/frontend.md) — read it before writing UI code. The three rules that fail _silently_ if ignored:

1. **Tailwind's default palette does not exist.** `apps/website/src/styles/globals.css` sets `--color-*: initial`, so `bg-black`, `text-white`, `text-red-500`, `bg-white/60` compile to **nothing** — no error, no style, the class just does nothing. Only the tokens in that `@theme` block work (`base`, `card`, `accent`, `overlay`, `primary`, `secondary`, `disabled`, `on-primary`/`on-secondary`/`on-tertiary`, `misc-accent`/`misc-danger`/`misc-warning`/`misc-system`). Read that file before picking any colour class, and spell out dark mode manually (`bg-card dark:bg-card-dark`) — the `-dark` tokens do not apply automatically. There is no `tailwind.config.*` file; that CSS file is the whole theme.
2. **Always use `@/components/common/Button`** — not a raw `<button>`, not `react-aria-components`' `Button` directly. It wraps `onPress` with automatic pending state and an error-banner safety net. It has no `variant` prop; copy the primary/secondary class recipes from `components/common/FormActions.tsx`, and use `FormActions` itself for any form's submit/cancel pair.
3. **Check `apps/website/src/components/common/` before building anything.** `TextField`, `TextAreaField`, `RawJsonField`, `SnowflakeInput`, `EmojiInput`, `ChannelSelect`, `RoleSelect`, `ForumTagSelect`, `ConfirmModal`, `EmptyState`, `Skeleton`, `Tooltip`, `SearchBar`, `FormActions` and more already exist. Search first; do not reinvent.
