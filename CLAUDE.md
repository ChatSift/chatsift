# CLAUDE.md

This file orients Claude Code (or any LLM agent) working in this repo.

## Start here

This repo is mid-rebirth. **Read [docs/roadmap/00-overview.md](docs/roadmap/00-overview.md) first** — it has the corrected product history (this repo was `ChatSift/AutoModerator`; AutoModerator itself now lives unchanged on the `v2` branch; AMA and ModMail are being ported in from their own separate production repos `ChatSift/AMA` and `ChatSift/ModMail`), the current beginning-stage goal, and links to every other doc.

Full doc set:

- [docs/roadmap/00-overview.md](docs/roadmap/00-overview.md) — history, glossary, milestone map. Read first.
- [docs/roadmap/01-architecture.md](docs/roadmap/01-architecture.md) — current architecture with code excerpts (API contract, DB stack, AMA bot subsystem).
- [docs/adr/0001-api-contract-pattern.md](docs/adr/0001-api-contract-pattern.md) — why the API contract pattern was replaced (implemented, M1).
- [docs/adr/0002-db-stack.md](docs/adr/0002-db-stack.md) — why the DB stack was replaced (implemented, M1).
- [docs/roadmap/05-migration-cutover.md](docs/roadmap/05-migration-cutover.md) — M4, AMA drain-and-swap cutover (in progress).
- [docs/roadmap/06-modmail-port.md](docs/roadmap/06-modmail-port.md) — M5, ModMail rebuild + migration (not started).
- [docs/workflow.md](docs/workflow.md) — branching, commits, local dev, verification standard.

M1–M3 (foundation refactor, dashboard polish, AMA feature-complete) are done and their per-milestone spec docs have been removed; durable architecture knowledge from them lives in 01-architecture.md and workflow.md now. Git history has the specs if you need the original planning detail.

## Quick facts

- Yarn 4 (Berry) workspaces + Turborepo monorepo, ESM, TypeScript strict.
- `apps/website` — Next.js App Router dashboard. `services/api` — polka HTTP API. `services/ama-bot` — gateway Discord bot. `packages/private/{core,backend-core}` — shared code.
- **This repo is being actively refactored** — M1 (foundation refactor) landed 2026-07-17, so the ADRs' "current/being replaced" framing is historical, not the present state; [01-architecture.md](docs/roadmap/01-architecture.md) has the actual current shape. Check the actual code first regardless — docs describe intent and rationale, not necessarily the exact present-moment state if work has progressed since a doc was last updated.
- Commands: `turbo run build`, `turbo run lint`, `yarn test` (vitest). Commit messages are commitlint-enforced (angular config) — see [docs/workflow.md](docs/workflow.md).
- Reference architecture for the API contract + DB patterns: `/Users/didinele/Documents/Work/didinele/SimplyChords` (private repo, local path only — not fetchable by URL).

## Working conventions

- Follow [docs/workflow.md](docs/workflow.md) for branching/commits/verification. In particular: **run the affected service and exercise the change** for anything with a runtime surface — typecheck and unit tests alone don't prove a feature works.
- AutoModerator (`v2` branch) is out of scope for all work described in `docs/roadmap/` — it's a separate, already-shipped product.
- **Never run `git commit` or any GitHub write action (creating milestones/labels/issues/PRs, etc.) on the user's behalf.** Do the analysis/content work, leave changes staged or written to disk, and hand back exact commands or a step-by-step instruction doc for the user to run themselves. Read-only `gh`/`git` inspection is fine.
