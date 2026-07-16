# Workflow

Conventions for working on the ChatSift rebirth (see [roadmap/00-overview.md](roadmap/00-overview.md) for product context).

## Branching & PRs

- Work happens on feature branches off `main`, one PR per logical change. Suggested branch naming: `<type>/<short-description>` (e.g. `feat/ama-guest-queue`, `refactor/defineRoute-ama-routes`, `docs/roadmap-scaffolding`).
- Squash-merge to `main` with a conventional-commit-style message (see below) — keeps `main`'s history one-commit-per-change even if a branch had many WIP commits.
- Reference the relevant milestone/issue in the PR description (`Closes #123`).
- Global merge gate: `turbo run build lint test` green. For changes with a runtime surface (anything other than docs/tests), also do a manual `/verify`-style pass — run the affected service(s) and exercise the change, don't rely on typecheck/tests alone to prove a feature works.

## Commit messages

This repo uses **commitlint** (`@commitlint/config-angular`) enforced by a `commit-msg` husky hook (`.husky/commit-msg`, `.commitlintrc.json`). Allowed types:

```
chore, build, ci, docs, feat, fix, perf, refactor, revert, style, test, types
```

Format: `<type>(<optional scope>): <subject>`. Scope case isn't enforced; exclamation-mark breaking-change markers aren't enforced either (both disabled in `.commitlintrc.json`). Example: `feat(ama-bot): add guest-review queue handlers`.

## Local environment

`docker-compose.yml` provides `postgres`, `redis`, `dozzle` (log viewer), plus containerized `api` and `ama-bot` services built from the root `Dockerfile`. For day-to-day development, run `postgres` + `redis` via compose and the Node services directly (`yarn workspace @chatsift/api dev`-style, or `turbo`-driven — confirm exact dev scripts per service as they're finalized in M1) for faster iteration than rebuilding containers each time.

Environment variables are split `.env.public` (checked in, non-secret defaults) / `.env.private` (gitignored, secrets) — see `.env.private.example` for the required shape.

### Database (post-M1)

Once [02-foundation.md](roadmap/02-foundation.md) lands, the `db:*` root scripts move from Prisma-flavored (`db:generate`, `db:migrate`, `db:deploy`, `db:studio`, all `dotenv -e .env.private -e .env.public -- prisma ...`) to Atlas/kanel-flavored equivalents:

- `db:migrate` → `atlas migrate apply` (was `prisma migrate dev`)
- `db:migrate:down` → `atlas migrate down` (new — didn't meaningfully exist before)
- `db:gen` → kanel codegen (was `prisma generate`)
- `db:diff` → `atlas migrate diff` (new — generates a migration from a schema change)

Update this section with the exact final script names once M1 lands them.

## Verification standard

Before calling any phase/issue done:

1. `turbo run build lint test` green.
2. Run the actual affected service(s) locally against a locally-migrated database (and a test Discord guild/bot token for bot-touching work) and exercise the golden path plus the edge cases called out in that phase's doc. Typecheck and unit tests verify code correctness, not feature correctness — this step is not optional for anything with a runtime surface.
3. For milestones with an explicit acceptance-criteria list (M1's zero-`@ts-expect-error` gate, M4/M5's migration-reconciliation checks), confirm each item explicitly before closing the milestone.

## Where to look first

New to a piece of this work? Start at [roadmap/00-overview.md](roadmap/00-overview.md), then the specific phase doc for what you're touching (`roadmap/02` through `06`). The two ADRs ([0001](adr/0001-api-contract-pattern.md), [0002](adr/0002-db-stack.md)) explain *why* the two big architectural changes were made, in case a decision looks arguable in the moment — reread the ADR before re-relitigating it.
