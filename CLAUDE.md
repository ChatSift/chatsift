# CLAUDE.md

This file orients Claude Code (or any LLM agent) working in this repo.

## Start here

This repo is mid-rebirth. **Read [docs/roadmap/00-overview.md](docs/roadmap/00-overview.md) first** — it has the corrected product history (this repo was `ChatSift/AutoModerator`; AutoModerator itself now lives unchanged on the `v2` branch; AMA and ModMail are being ported in from their own separate production repos `ChatSift/AMA` and `ChatSift/ModMail`), the current beginning-stage goal, and links to every other doc.

Full doc set:

- [docs/roadmap/00-overview.md](docs/roadmap/00-overview.md) — history, glossary, milestone map. Read first.
- [docs/roadmap/01-architecture.md](docs/roadmap/01-architecture.md) — current-vs-target architecture with code excerpts.
- [docs/adr/0001-api-contract-pattern.md](docs/adr/0001-api-contract-pattern.md) — why the API contract pattern is being replaced.
- [docs/adr/0002-db-stack.md](docs/adr/0002-db-stack.md) — why the DB stack is being replaced.
- [docs/roadmap/02-foundation.md](docs/roadmap/02-foundation.md) through [06-modmail-port.md](docs/roadmap/06-modmail-port.md) — per-milestone specs.
- [docs/workflow.md](docs/workflow.md) — branching, commits, local dev, verification standard.
- [docs/github-setup.md](docs/github-setup.md) — copy-pasteable `gh` commands for milestones/labels/seed issues (M0). Present these as instructions for the user to run — do not execute GitHub writes directly (see Working conventions below).

## Quick facts

- Yarn 4 (Berry) workspaces + Turborepo monorepo, ESM, TypeScript strict.
- `apps/website` — Next.js App Router dashboard. `services/api` — polka HTTP API. `services/ama-bot` — gateway Discord bot. `packages/private/{core,backend-core}` — shared code.
- **This repo is being actively refactored** — do not assume the patterns described in the ADRs as "current/being replaced" are still the target once M1 ([docs/roadmap/02-foundation.md](docs/roadmap/02-foundation.md)) lands. Check the actual code first; the docs describe intent and rationale, not necessarily the exact present-moment state if work has progressed since a doc was last updated.
- Commands: `turbo run build`, `turbo run lint`, `yarn test` (vitest). Commit messages are commitlint-enforced (angular config) — see [docs/workflow.md](docs/workflow.md).
- Reference architecture for the API contract + DB patterns: `/Users/didinele/Documents/Work/didinele/SimplyChords` (private repo, local path only — not fetchable by URL).

## Working conventions

- Follow [docs/workflow.md](docs/workflow.md) for branching/commits/verification. In particular: **run the affected service and exercise the change** for anything with a runtime surface — typecheck and unit tests alone don't prove a feature works.
- AutoModerator (`v2` branch) is out of scope for all work described in `docs/roadmap/` — it's a separate, already-shipped product.
- **Never run `git commit` or any GitHub write action (creating milestones/labels/issues/PRs, etc.) on the user's behalf.** Do the analysis/content work, leave changes staged or written to disk, and hand back exact commands or a step-by-step instruction doc for the user to run themselves. Read-only `gh`/`git` inspection is fine.
