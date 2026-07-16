# M2 — Dashboard-config solid spec

**Milestone target:** ~2026-09-17 (4 weeks from M1 completion at ~7 hrs/wk). **Depends on:** M1 (built on the new API contract + DB stack). **Can interleave with:** M3 (AMA bot work) — config UI and bot features naturally inform each other.

## Goal

Take the existing dashboard shell from "it technically works" to **production quality**, on top of the M1 foundation. This is UI/UX + completeness work, not a new architecture. **Marketing site is explicitly out of scope and deferred indefinitely** — no home page, pricing page, or product marketing pages this stage. All effort goes into the authed dashboard-config experience.

## Current state (what exists, per `apps/website/src/app/`)

- `app/dashboard/page.tsx` + `_components/` (`GuildList`, `GuildCard`, `DashboardCrumbs`, `RefreshGuildsButton`) — guild picker.
- `app/dashboard/[id]/` (`layout.tsx`, `page.tsx`) — per-guild dashboard shell. `page.tsx` has an unresolved `// TODO` (line ~76 as of `main`).
- `app/dashboard/[id]/settings/` (`_components/GrantsList`, `GrantCard`, `AddGrantCard`) — dashboard-access grants management.
- `app/dashboard/[id]/ama/` — AMA product area:
  - `page.tsx` + `_components/AMADashboardCrumbs.tsx` — has an unresolved `// TODO`.
  - `ama/amas/page.tsx` + `_components/` (`AMASessionsList`, `AMASessionCard`, `CreateAMACard`, `IncludeEndedToggle`) — sessions list.
  - `ama/amas/new/page.tsx` + `_components/CreateAMAForm.tsx` (the largest component, ~12K) + `NormalPromptFields`, `RawPromptField`, `PromptModeToggle`, `SnowflakeInput`, `RefreshServerDataButton` — AMA creation form.
  - `ama/amas/[amaId]/page.tsx` + `_components/AMADetails.tsx` (~9K) — session detail view.
- Other loose ends: `components/user/UserErrorHandler.tsx` has a `// TODO?`; `components/common/Providers.tsx` has a `// TODO: Handle in some way`.

## Scope for M2

1. **Resolve every `// TODO` placeholder** currently in the dashboard tree (the four listed above at minimum — re-grep at kickoff since M1 touches these files too and may introduce/resolve others).
2. **Guild picker polish** — loading/empty/error states, guild search/filter if the list can get long, refresh behavior (`RefreshGuildsButton`) correctness.
3. **Per-guild shell** — consistent breadcrumbs (`DashboardCrumbs`/`AMADashboardCrumbs`) across all sub-areas, consistent nav between settings/AMA/(future ModMail), loading skeletons instead of spinners-everywhere, sensible 403/404 handling for guilds the user doesn't manage.
4. **Grants (settings) to production quality** — create/list/delete grant UX, confirmation on delete, clear indication of who granted what and when (`createdById` is already tracked).
5. **AMA config screens to production quality:**
   - `CreateAMAForm.tsx` — validate against the same zod schema the API uses (now reusable directly per [ADR 0001](../adr/0001-api-contract-pattern.md)); clear channel-picker UX for mod/guest/flagged queues + answers/prompt channels; the normal-vs-raw prompt mode toggle should have obvious affordances and live preview if feasible.
   - `AMASessionsList` / `AMASessionCard` — clear status (ended vs. active), include-ended toggle, question-count display (already returned by `getAMAs`), sensible sort/filter.
   - `AMADetails.tsx` — full session config visible/editable (channels, upload limits), repost-prompt action wired to `useRepostPrompt`, and space reserved for the analytics/export surface being built in M3 (this doc's UI should have a slot; the data comes from M3).
6. **Error/loading UX audit** — `UserErrorHandler.tsx` and `Providers.tsx` TODOs likely relate to global query-error handling (401/403 redirect, 5xx toast/banner); decide and implement a single consistent pattern app-wide.
7. **Responsive pass** — dashboard must work on tablet width at minimum; verify with the running app, not just by inspection (see [workflow.md](../workflow.md) for the local run + verify procedure).

## Explicitly out of scope

- Any marketing/landing/pricing page. Deferred indefinitely per owner decision — do not build "just a placeholder" either; skip entirely.
- ModMail dashboard screens — that's M5 ([06-modmail-port.md](06-modmail-port.md)).
- AutoModerator dashboard screens — AutoModerator is out of scope for the whole beginning stage (it lives, unchanged, on `v2`).

## Verification

Full click-through of the authed dashboard with a real Discord login against a locally-migrated database seeded with at least: one guild with dashboard access, one grant, 2+ AMA sessions (one ended, one active) with questions in varying states. Confirm no console errors, no unresolved TODOs remain in the touched files, and the flows work at both desktop and tablet widths.
