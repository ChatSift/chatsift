# #232 — Appeals (ban & timeout appeals, `unban.app`, the Appeals bot)

**Tracking issue:** [#232](https://github.com/ChatSift/ChatSift/issues/232). **Depends on:** nothing that is still in flight —
M4's AMA cutover ([05-migration-cutover.md](05-migration-cutover.md)) and M5's ModMail data migration
([06-modmail-port.md](06-modmail-port.md)) are independent of this and neither blocks nor is blocked by it. **Live production
impact:** none until P3, and additive thereafter: new tables, a new Discord application, a new site. No existing product's
behavior changes at any point, and there is no data migration.

## Status: not started — this document is the plan

Nothing below is implemented. `09-` is the next free roadmap slot; 02/03/04 (M1–M3), 07 (#261) and 08 (#216) were all
consumed and deleted once their work shipped. This doc follows the same lifecycle: when the phases land, it gets **deleted**
and its durable shape is condensed into a new `## 9. Appeals (#232)` section of
[01-architecture.md](01-architecture.md), with the operator runbook (registering the interactions endpoint, onboarding a
guild) going to [workflow.md](../workflow.md) — the same split §8 uses today.

## Goal

Let a user who has been banned (or timed out) in a guild that uses ChatSift submit a structured appeal, and let that guild's
moderators decide on it from either Discord or the dashboard. Three surfaces, one backend:

- **`unban.app`** — a public Next.js app under its own Discord application, where appellants log in, find the guild, answer
  the guild's appeal questions, and track status.
- **The dashboard** (`automoderator.app/dashboard/<id>/appeals`) — guild configuration, plus a full appeals queue and history
  with the same actions available in Discord.
- **The Appeals bot** — a Discord application with no gateway connection and no commands in user-facing guilds. It posts
  appeals into a mod channel with action buttons, and it delivers decisions to the appellant over DM. Making a banned user
  DM-reachable at all is the least obvious problem in the whole feature; §6 is about nothing else.

## Owner's decisions (2026-07-31)

Captured verbatim in intent, since several of these close off otherwise-reasonable alternatives. 12–16 came out of a PM
review on 2026-07-31 (comparison against existing appeal bots as deployed on a large server), and several of them overturn
what 1–11 originally said — where they do, the superseded version is left visible rather than quietly edited out.

1. **Both mod surfaces ship together.** #232 was torn between "manage appeals on the dashboard via grant tokens" and "the
   dashboard is read-only, actions happen via in-Discord buttons". Neither — both, from the start, converging on one shared
   `applyAppealDecision()` transition rather than two parallel implementations that drift.
2. **The Appeals bot is HTTP-only and lives inside `services/api`.** No new service, no new container. It has no gateway
   connection, no commands in user-facing guilds, and exists on Discord's side purely as an application id, an interactions
   endpoint, and a bot token used for REST.
3. **`unban.app` is its own Next app under its own Discord application.** OAuth goes through the Appeals application, not
   ChatSift's, so a banned user is never asked to authorize something branded for a product they have no relationship with.
4. **`packages/private/web-core` gets extracted first**, before a second Next app exists to duplicate into.
5. **Ban status is discovered lazily. Never fan out on login.** See the architecture section — this is the single decision
   most likely to be "fixed" back into a scaling failure by a future session that hasn't read the reasoning.
6. **Denials can be silent**, and a silent denial is publicly indistinguishable from a pending one: the appellant's view
   keeps reading "under review" indefinitely. Terminal and closed for moderators, invisible to the appellant.
7. **Appeal questions are per-guild configurable**, but answers store a snapshot of the prompt they were answering, so
   editing a question later never rewrites history — and so the configurable-questionnaire phase is additive rather than a
   data migration.
8. **Bans can be marked unappealable** both manually (a per-guild user list) and automatically (patterns matched against the
   ban reason).
9. **Timeouts are appealable too**, as a later phase. They are a genuinely different shape — the appellant is still a guild
   member and the punishment expires on its own — so they do not get retrofitted into the ban path.
10. ~~**The notification guild is real infrastructure, not a nicety.** A bot can only DM a user it shares a guild with, and an
    appellant is by definition not in the guild they are appealing to. Without it, approvals cannot be delivered.~~
    **Superseded by §6, confirmed 2026-08-03**: a user install of the Appeals application DMs the appellant directly, no shared
    guild required. Owner tested it manually — the consent screen shows "Send you direct messages" as its own line alongside
    "Create commands" for a user install, and a DM was actually delivered with no shared guild. The plan now relies on this
    entirely; the notification guild is dropped, not merely demoted.
11. **No self-serve custom Appeals instances.** #216's per-partner branded deployments are a ModMail concept and stay one.
12. **Discovery is a direct link or an invite code — not a browsable list, and not your own guild list.** This supersedes the
    directory in the original draft. You cannot pick a guild you are banned from out of your own guild list, because you are
    not in it; and a public directory of every guild using Appeals is an enumeration surface nobody asked for. Entry points:
    `unban.app/g/<guildId>`, plus **`unban.app/<inviteCode>` — swap `discord.gg` for `unban.app` in any invite you already
    have** (a trick worth copying outright: it needs no search box, no explanation, and works from a link the appellant
    already has in their scrollback).
13. **One embed per appeal, in a thread.** The mod channel is either a text channel where the bot posts a single embed and
    immediately creates a thread on it, or a forum channel where each appeal is its own post. **Never two embeds** — this was
    the PM's specific, unprompted complaint about an existing appeal bot, and it is the kind of thing that is free to get right
    now and annoying forever if not. The embed is edited in place for the life of the appeal.
14. **Approval can re-add the user, opt-in on both sides.** The guild enables it, and the appellant must have granted
    `guilds.join`. When either side hasn't opted in, approval DMs an invite instead.
15. **Appeals stays its own Discord application rather than folding into ModMail.** Raised at the PM review as "designate an
    appeals forum in ModMail, keep the experience consistent". Rejected: decision 3's branding argument is the whole reason
    the separate application exists, and ModMail already carries custom instances (#216) and DM mode, so an appeals forum
    inside it would have to be gated out of every one of those paths. The cost of the split is one more bot in the guild list.
16. **ChatSift does not send the ban DM.** Some existing appeal bots DM the user their ban reason and appeal link _before_
    banning, which is only possible for the bot issuing the ban — and that is somebody else's mod bot. The dashboard
    surfaces the guild's appeal link for copy-paste into their existing ban-reason template instead. AutoModerator could close
    this loop natively one day; that is not this issue.

## Architecture

### End to end, in one pass

A guild's mods enable Appeals from the dashboard and pick a mod channel. A banned user lands on `unban.app` — via
`unban.app/g/<guildId>` from the guild's own ban message, or by swapping `discord.gg` for `unban.app` in an invite they
already have — logs in through the Appeals application, and the API confirms the ban with a single Discord call. They answer
the guild's questions and submit. The API writes the appeal, then posts one embed into the mod channel and opens a thread on
it, carrying Approve / Deny / Deny silently / Ask for more info. Whichever surface the decision comes from, it funnels into
one transition that writes the row, unbans (and optionally re-adds) on approval, and — unless the denial is silent — DMs the
appellant.

### 1. HTTP interactions, with no prior art in this repo

Every interaction in this repo today arrives over the gateway. There is no Ed25519 verification anywhere, no interactions
endpoint, and no dependency that provides either. Four things to get right:

**Verify against the raw bytes.** `jsonParser(true)` (`services/api/src/middleware/jsonParser.ts`) already exposes
`req.rawBody`, which is exactly what signature verification needs. But `mountRoute` (`services/api/src/core/server.ts`) only
inserts `jsonParser()` — no-arg, so no `rawBody` — and only when the route declares `schema.body`. So the interactions route
declares **no** body schema and carries its own middleware pair instead: a `defineMiddleware` wrapper around
`jsonParser(true)`, then `verifyDiscordSignature()`. `services/api/src/middleware/requireWebhookSecret.ts` is the closest
existing shape to model the latter on (an unauthenticated-by-session POST gated by a header check).

**No new dependency.** Node's `crypto.verify` does Ed25519 natively. The raw 32-byte public key Discord gives you is not
directly loadable — prefix it with the standard SPKI DER header (`302a300506032b6570032100`) and hand the result to
`createPublicKey({ format: 'der', type: 'spki' })`. Worth knowing up front rather than discovering it mid-phase.

**Answer `PING` (type 1), and answer everything within 3 seconds.** Reply with a deferred callback type in the HTTP response
body itself, then do the real work and finish via REST follow-ups on the interaction token. Any decision path that touches
Postgres and Discord will not fit in the synchronous window.

**Do not refactor `@chatsift/bot-core` for this.** `handleComponentInteraction`
(`packages/private/bot-core/src/lib/components.ts`) replies through `getContext().service.client.api`, which does not exist in
the API process — bot-core is gateway-shaped by construction. Instead, a small API-local dispatcher that _copies_ its two good
conventions: `custom_id` as `name:stateId`, and `RedisStore`-backed state for anything that doesn't fit in the id. That is a
few dozen lines of deliberate duplication, against making a package transport-agnostic for exactly one consumer.

### 2. `bot:APPEALS` presence without a gateway

This is the one thing that does not work for free once you drop the gateway, and it is load-bearing: without it the dashboard
never renders an Appeals badge or section for any guild, so the feature is invisible.

`GuildList` (`packages/private/backend-core/src/lib/data/bots.ts`, key `bot:<BotId>`, `TTL: null`) is written **only** by
`createBotClient`'s 10-second flush in `packages/private/bot-core/src/lib/client.ts`, fed by `GUILD_CREATE`/`GUILD_DELETE`. An
HTTP-only bot receives neither event, so nothing would ever populate `bot:APPEALS`, and `fetchMe`'s `BOTS.filter(...)`
(`services/api/src/util/me.ts`) would report Appeals as installed nowhere.

**Resolution: poll `GET /users/@me/guilds` with the Appeals bot token** from a `.unref()`'d interval in `services/api`
(paginated via `after`, `limit=200`), writing `GuildList.set('APPEALS', { guilds })`. Bots may call this endpoint; it is
authoritative for both additions and removals; it needs no new Redis shape; and `fetchMe` then picks Appeals up with no
special-casing at all, unlike the `MODMAIL#<instance>` union #216 had to add. Cadence mirrors the 60-second `.unref()`'d
refresh `loadInstances()` (`packages/private/backend-core/src/lib/instances.ts`) already establishes.

- **Optional accelerant, not a mechanism:** Discord's `APPLICATION_AUTHORIZED` webhook event, delivered to the same
  Ed25519-verified endpoint, can add a guild the moment the bot is invited instead of waiting out the poll interval. There is
  no reliable matching "removed" event, so the poll remains the reconciler either way. Nice-to-have, no earlier than P6.
- **Rejected: deriving presence from an `appeals_settings` row.** It cannot distinguish "installed but not yet configured"
  from "not installed" — which is precisely the state the dashboard's setup CTA has to render.
- **Free win worth noting:** adding `'APPEALS'` to `BOTS` (`packages/private/core/src/lib/constants.ts`) does **not** require
  bumping the `me2:` Redis cache key. `bots` is a `stringLiteral<BotId>()` array in the `bin-rw` recipe, so the encoded shape
  is unchanged. Contrast #216 P2, which widened the recipe itself and did need the bump.

### 3. Two Discord applications, two eTLD+1s

`unban.app` cannot share the dashboard's session. `cookieWithDomain` (`services/api/src/util/constants.ts`) pins cookies to
`ROOT_DOMAIN` (`automoderator.app`), a different eTLD+1, and the OAuth application is a single global pair
(`OAUTH_DISCORD_CLIENT_ID`/`_SECRET`) hardcoded by `services/api/src/routes/auth/discord.ts`. What that costs:

- New env in `packages/private/backend-core/src/lib/env.ts`: `APPEALS_BOT_TOKEN`, `APPEALS_PUBLIC_KEY`,
  `APPEALS_OAUTH_CLIENT_ID`, `APPEALS_OAUTH_CLIENT_SECRET`, `APPEALS_ROOT_DOMAIN`, `APPEALS_FRONTEND_URL_{DEV,PROD}`.
- A parallel `/v3/appeals/auth/discord` + `/v3/appeals/auth/discord/callback` pair. Scopes start at `identify` alone —
  deliberately minimal for a site whose users have no reason to trust it — and gain `guilds` only when P9 needs it.
- A distinct cookie name (`appeals_refresh_token`) **and** a `kind` discriminator in the JWT payload, so an appeals session
  can never authenticate a dashboard route even if a cookie leaks across. This is the same defense `GrantTokenData`'s
  `kind: 'grant'` already provides (`packages/private/backend-core/src/lib/grantToken.ts`) — reuse the pattern, don't invent
  a second one.
- A second allowlisted origin in `sanitizeRedirectTo` (`services/api/src/util/redirectTo.ts`), which today hard-gates to the
  one frontend origin _and_ a `/dashboard` path prefix. Appeals paths are not under `/dashboard`.
- A widened `CORS` regex in `.env.public`.

### 4. Ban discovery — why the obvious design is wrong

A banned user is not a guild member, so OAuth `guilds` never reveals which guilds they are banned from. The obvious answer is
to check every appeals-enabled guild at login. **Do not.**

- It is O(appeals-enabled guilds) Discord calls **per page view**, all against one bot token's global bucket. It starves on
  throughput long before anything else goes wrong, and it degrades precisely as the product succeeds.
- It is also how you manufacture real invalid requests. Any guild where the Appeals bot lacks `BAN_MEMBERS` returns `403` on
  every probe, and `403` — with `401` and `429` — counts toward Discord's 10,000-per-10-minutes Cloudflare ban.
  (`404 Unknown Ban` does _not_ count. The reasoning above stands without it.)

**The probe primitive:** `GET /guilds/{guildId}/bans?limit=1&after=<userId - 1n>`, then `result[0]?.user.id === userId`. This
always returns `200` — an empty array or a single entry — so the happy path never emits a 4xx at all, and it returns the
**ban reason** in the same call, which is what P8's pattern matching consumes. Snowflake arithmetic in `BigInt`. Confirm the
`before`/`after` direction empirically in P1; guessing wrong fails closed (every banned user reads as not-banned), so it
surfaces on the first manual test instead of corrupting anything.

**Lazy by default.** Ban status is asserted once the appellant is on a specific guild (one probe) and **re-asserted
authoritatively at submit** (one more). Correctness only has to hold at submit time; everything before it is a hint.

**Two entry points, and no list at all** (decision 12):

- **`unban.app/g/<guildId>`** — the deep link a guild pastes into its own ban-reason template or rules channel. The expected
  arrival path for most appellants, and the reason the discovery problem is usually not a problem.
- **Invite search** — the appellant pastes a server invite and `GET /invites/{code}` resolves it to a guild id in a single
  call, which the probe then runs against. This is what makes the product usable for someone who arrived with nothing but the
  name of the server that banned them.

**No "which servers am I banned in?" list is offered, in any form.** The honest version is the fan-out this section rejects.
The dishonest version — a best-effort list maintained in the background — is worse than no list: it is wrong exactly when
someone relies on it, and a single blip of downtime means it can never be trusted again without the full re-sync that makes
the fan-out untenable in the first place. Showing the user their own guild list doesn't help either; by construction, the
guild they want is not in it.

One reduction to build in from the start: cache "this guild's bot lacks `BAN_MEMBERS`" negatively per guild, so a
misconfigured guild costs one `403` in total rather than one per appellant forever.

`appeal_ban_checks` survives the removal of the fan-out as a plain cache of probe results — it gives a returning appellant
their previously-checked servers without re-probing, and it is where P8 reads the ban reason from.

**Rejected: a gateway-mirrored ban table.** Beyond needing the gateway process decision 2 rules out, any downtime forces a
full paginated `GET /guilds/{id}/bans` re-sync across every guild — strictly worse than the thing it replaces, and worse in
exactly the moment you can least afford it. This is the same failure mode that makes the current production ModMail slow to
respond to a DM, roughly tripled.

**P9's asymmetry:** none of this applies to timeouts. A timed-out user is still a member, so OAuth `guilds` plus a single
`GET /guilds/{id}/members/{userId}` (reading `communication_disabled_until`) answers the question with no discovery problem.

### 5. Silent denials

A silent denial is terminal and closed for moderators, while the appellant's view never changes — the site keeps reading
"under review" indefinitely.

`appeals.status` holds the internal truth; a separate `silent BOOLEAN` marks it. The appellant-facing serializer derives a
_public_ status that maps `denied && silent` back to `pending`, and appellant-facing routes must never expose
`appeal_events`, `decided_at`, `decided_by_id`, or the decision reason under any circumstances. **That serializer is the
single choke point** — name it, route every appellant-facing response through it, and unit-test the mapping, because a leak
here is a one-line mistake that nothing else in the stack would catch.

Two consequences to carry into later phases: P6 must branch on `silent` and send no DM, and both mod surfaces must label a
silent denial unmistakably, so a second moderator doesn't helpfully follow up and blow it.

### 6. Decision delivery — user-install DMs

An ordinary bot may only DM a user it shares a guild with, and the appellant is by definition banned from the guild they are
appealing to. That constraint is what the original draft's notification guild existed to work around. The PM review reported
that an existing appeal bot instead just "asks permission to DM you" at login and that it "seems to work perfectly for users",
so this was researched rather than assumed. What the research found, then confirmed by hand:

- **There is no OAuth2 scope that grants an app permission to send DMs.** Of Discord's ~31 scopes, the only DM-adjacent one is
  `dm_channels.read`, which is read-only and restricted to approved partners. Anyone who tells you to "just request the DM
  scope" is wrong; do not spend time looking for it.
- **A _user install_ grants it instead.** [Userdoccers](https://docs.discord.food/topics/oauth2) documents, as a footnote on
  `applications.commands`: "In a user install context, this scope also allows the application to send DMs to the user."
  Discord's own docs don't state this explicitly. **Confirmed manually, 2026-08-03**: authorizing a test application as a user
  install shows "Send you direct messages" as its own line on the consent screen, separate from "Create commands", and a DM
  was actually delivered to the installer with no shared guild anywhere. Open question 1 is resolved.

**The plan: authorize the Appeals application as a user install** (`applications.commands` with `integration_type=1`) on
`unban.app`, and DM the appellant directly. This is the sole delivery mechanism — no guild to create, no rules to enforce, no
ModMail deployment for it, no mass-adding thousands of banned users into one shared space.

**Rejected alternative: the notification guild.** The original draft's plan — a ChatSift-owned guild with no text channels
beyond one read-only info channel, the appellant added silently via `guilds.join` at login, one rule (members may not DM each
other) enforced with ModMail — is superseded outright now that the user-install path is confirmed, not merely kept on standby.
It is not being built. If Discord ever changes user-install DM behavior, this paragraph is where a future session should start
over, not resurrect unbuilt infrastructure sized for a different-shaped problem years later.

Delivery is still _possible_, never _certain_ — the appellant can have DMs closed regardless of mechanism. Reachability is
probed and persisted per user (`appeal_user_state`), and both `unban.app` and the mod-side embed warn, before a decision is
made, that it probably cannot be delivered.

**Approval can re-add the user** (decision 14), and this genuinely does need `guilds.join` — against the appealing guild,
requiring `CREATE_INSTANT_INVITE` on the Appeals bot there, gated on the guild having enabled it. Two consequences worth
naming: it needs the appellant's OAuth credentials to still be valid at decision time, which is days or weeks after they
submitted, so their refresh token has to be stored — encrypted at rest with `encrypt`/`decrypt` from `@chatsift/backend-core`
(`lib/crypt.ts`), the same helper #216 uses for instance bot tokens. And when either side hasn't opted in, or the re-add
fails, approval falls back to DMing an invite.

## Data model

Following `packages/private/db/schema/schema.sql` conventions throughout: plural snake_case, `id INTEGER GENERATED BY DEFAULT
AS IDENTITY PRIMARY KEY`, snowflakes as `TEXT`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, explicitly named constraints
and indexes, and inline `--` comments carrying the semantics.

```sql
-- Per-guild Appeals configuration (#232). A row here means the guild has finished setup; the Appeals
-- bot merely being present (bot:APPEALS) is what the dashboard's setup CTA keys off instead.
CREATE TABLE appeals_settings (
  guild_id              TEXT PRIMARY KEY,
  -- Where appeals are posted. A text channel gets one embed per appeal with a thread created on it
  -- immediately; a forum channel gets one post per appeal. Either way: exactly one embed, edited in
  -- place for the life of the appeal (decision 13).
  mod_channel_id        TEXT NOT NULL,
  -- How long after a decision before the same user may appeal the same punishment again.
  cooldown_days         INTEGER NOT NULL DEFAULT 30,
  -- Hard ceiling on appeals per (user, punishment), independent of the cooldown. NULL = no ceiling.
  max_appeals           INTEGER,
  -- Guild half of decision 14's two-sided opt-in: approving an appeal re-adds the user via
  -- guilds.join instead of just unbanning them. The appellant's half is whether they granted the
  -- scope; without both, approval DMs an invite instead.
  auto_rejoin           BOOLEAN NOT NULL DEFAULT false,
  -- P9. Kept here rather than a second settings table so the whole product is one row per guild.
  allow_timeout_appeals BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The guild's appeal questionnaire. Seeded with a default set on setup (P1/P2); editable from P7.
CREATE TABLE appeal_questions (...);

-- One appeal. `status` is the internal truth -- see the silent-denial note above: appellant-facing
-- responses go through a serializer that maps (status='denied' AND silent) back to 'pending', and
-- must never expose decided_at/decided_by_id/decision_reason.
CREATE TABLE appeals (
  id              INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  guild_id        TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  kind            TEXT NOT NULL,  -- 'ban' | 'timeout' (P9)
  status          TEXT NOT NULL DEFAULT 'pending',
  -- 'pending' | 'needs_more_info' | 'approved' | 'denied' | 'withdrawn'
  silent          BOOLEAN NOT NULL DEFAULT false,
  -- The ban reason as it read when the appeal was filed, for the record and for P8's matching.
  reason_snapshot TEXT,
  -- The single embed (decision 13) and the thread/forum post it lives on, so both can be edited in
  -- place rather than re-posted.
  mod_message_id  TEXT,
  mod_thread_id   TEXT,
  decided_at      TIMESTAMPTZ,
  decided_by_id   TEXT,
  decision_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Answers, each carrying a snapshot of the prompt it answered (decision 7).
CREATE TABLE appeal_answers (... prompt_snapshot TEXT NOT NULL ...);

-- Audit trail plus the ask-for-more-info exchange. NEVER served to the appellant.
CREATE TABLE appeal_events (...);

-- Cache of per-guild probe results, so a returning appellant sees the servers they already checked
-- without re-probing. Deliberately allowed to go stale: the probe re-establishes truth when they open
-- a guild and again at submit. NOT a ban index -- see the ban-discovery section on why there isn't one.
CREATE TABLE appeal_ban_checks (
  user_id    TEXT NOT NULL,
  guild_id   TEXT NOT NULL,
  banned     BOOLEAN NOT NULL,
  ban_reason TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT appeal_ban_checks_user_id_guild_id_key UNIQUE (user_id, guild_id)
);

CREATE TABLE unappealable_users (...);     -- manual, per guild
CREATE TABLE unappealable_patterns (...);  -- P8, matched against the ban reason
-- Per-appellant: DM reachability, whether they granted guilds.join, and their OAuth refresh token
-- encrypted with backend-core's encrypt()/decrypt() -- needed because decision 14's re-add happens
-- days or weeks after they authorized. Nothing here is ever exposed to a guild's moderators.
CREATE TABLE appeal_user_state (...);
```

Authoring flow is the usual one (`yarn db:diff` → `yarn db:migrate` → `yarn db:gen`, then export the generated row types from
`packages/private/db/src/index.ts` as consumers need them). Read #216 P4's lesson before running `db:diff` on anything that
looks like a rename: Atlas renders renames as `DROP COLUMN` + `ADD COLUMN`, which silently nulls real rows.

## Phases

Each phase is one PR, each independently mergeable. P0–P2 ship no user-visible Appeals product at all; the first thing an
appellant can actually use arrives in P3, and the first thing a moderator can act on arrives in P4+P5 together.

### P0 — Extract `packages/private/web-core`

- New `packages/private/web-core` (`@chatsift/web-core`), taking from `apps/website/src`: `api/fetch.ts`, `api/error.ts`,
  `api/store.ts`, `api/token.ts`, `api/queryClient.ts` (the generic half — `queryKeys` stays app-local), `api/formErrors.ts`,
  `api/errorBanner.ts`, `components/common/*`, `utils/util.ts` (`cn`), the Tailwind `@theme` block from
  `src/styles/globals.css`, `src/styles/author.css`, and the fonts under `public/assets/fonts`.
- `apps/website`: re-point every import; `next.config.mjs` gains `transpilePackages`.
- Verify `'use client'` survives the package boundary — every interactive component depends on it.
- Zero behavior change by construction. Large diff, no new surface.

_Verify:_ `turbo run build lint test` green; run `apps/website` locally and click through dashboard → guild → each of the AMA
and ModMail sections, confirming forms submit, error banners still fire on a forced background-refetch failure, and light/dark
theming and the custom font are unchanged; diff the built page output if anything looks subtly off.

### P1 — Appeals bot identity, guild presence, schema, config API

- `packages/private/core/src/lib/constants.ts`: `'APPEALS'` added to `BOTS`.
- `packages/private/backend-core/src/lib/env.ts`: the six `APPEALS_*` vars from §3; `.env.private.example` updated.
- `services/api/src/util/discordAPI.ts`: an `APPEALS` entry in `APIMapping`. Appeals never resolves to a custom instance —
  that stays a ModMail-only concept, same as `AMA`.
- `services/api/src/util/appealsPresence.ts` (new): the `GET /users/@me/guilds` poll writing `GuildList.set('APPEALS', ...)`,
  started from `services/api/src/bin.ts` next to `loadInstances()`, `.unref()`'d.
- `packages/private/db`: every table from the data model above, one Atlas migration, kanel regen, types exported.
- `services/api/src/routes/appeals/config/{getConfig,updateConfig}.ts` + the manual unappealable-user CRUD; registered in
  `app.ts` and re-exported from `services/api/src/index.ts`.
- `services/api/src/util/appealsBans.ts` (new): the `limit=1&after` probe, the negative `BAN_MEMBERS` cache, and the
  `appeal_ban_checks` read/write helpers.

_Verify:_ boot `services/api` with the new env and confirm `bot:APPEALS` populates in Redis within one poll interval and
tracks the bot being kicked from a test guild; confirm `/v3/auth/me` starts reporting `APPEALS` in `bots` for that guild with
no `me2:` key bump; probe a known-banned and a known-not-banned user against a test guild and confirm both return `200` and
the right answer; confirm the direction of `before`/`after` empirically here rather than trusting the docs.

### P2 — Dashboard: Appeals config section

- `apps/website/src/app/dashboard/[id]/appeals/{page.tsx,config/page.tsx}` + `_components/`, following the ModMail config
  section's shape exactly (server page = crumbs + heading + `RefreshServerDataButton`, one client form beneath it).
- Manual unappealable-user list with add/remove, modeled on the ModMail blocks list.
- `apps/website/src/utils/bots.tsx` and the dashboard section-card loop gain the Appeals entry.
- `queryKeys.appeals.*` in `api/queryClient.ts`; hooks in `api/routes/appeals.ts` deriving types via `InferRouteContract`.
- The question set is the built-in default and is displayed read-only. P7 makes it editable.

_Verify:_ with the bot in a test guild but no `appeals_settings` row, the dashboard shows the setup CTA and not the section;
after saving a config the section appears, survives a reload, and rejects a mod channel in another guild.

### P3 — `apps/appeals` / `unban.app`

- `apps/appeals`: new Next app on `@chatsift/web-core`. Covered by the existing `apps/*` workspace glob, the generic turbo
  `build` task, and the eslint `apps/**` globs — no root config changes beyond its own `package.json`/`next.config.mjs`/
  `tsconfig*.json`/`postcss.config.js`.
- `services/api/src/routes/appeals/auth/{discord,discordCallback}.ts`: the parallel OAuth pair from §3, with
  `identify applications.commands guilds.join` and `integration_type=1` (user install — §6 for what each scope buys),
  `appeals_refresh_token` cookie, `kind` discriminator in the JWT, `APPEALS_ROOT_DOMAIN` cookie domain. The appellant's own
  refresh token is persisted encrypted to `appeal_user_state` here.
- `services/api/src/util/redirectTo.ts` and the `CORS` regex widened for the appeals origin.
- Site: `/g/<guildId>` and `/<inviteCode>` (decision 12) — **no directory, no guild list** — then the probe result, the submit
  form, and the public status view.
- `services/api/src/routes/appeals/{resolveInvite,checkGuild,submitAppeal,listMyAppeals}.ts`. `resolveInvite` is a single
  `GET /invites/{code}` mapped to a guild id, refusing codes for guilds with no `appeals_settings` row. `submitAppeal`
  re-probes the ban authoritatively, enforces cooldown / `max_appeals` / unappealable, and writes answers with their
  `prompt_snapshot`.
- Route-shape care: `/<inviteCode>` is a catch-all at the site root, so it has to lose to every real route (`/g/...`, auth
  callbacks, static assets) and 404 cleanly on anything that isn't a live invite.
- The appellant-facing serializer from §5 lands here, before there is any way to produce a silent denial — so the mapping is
  in place and tested by the time P4 can create one.

_Verify:_ log in on `unban.app` locally with a second Discord application and confirm the dashboard session on
`automoderator.app` is untouched and vice versa; confirm an appeals cookie is rejected by a dashboard route; confirm the
consent screen shows both "Create commands" and "Send you direct messages" for the user install, matching the manual test
behind §6; reach a guild both by deep link and by pasting an invite, including an invite for a guild that doesn't use Appeals
and an expired one; submit an appeal end to end for a real banned test account; confirm submit is refused for a user who is
not actually banned, for an unappealable user, and inside the cooldown window.

### P4 — Interactions endpoint, mod notifications, the shared decision path

- `services/api/src/middleware/verifyDiscordSignature.ts` (new) + the `jsonParser(true)` wrapper from §1.
- `services/api/src/routes/appeals/interactions.ts` (new): `PING`, then dispatch to an API-local component/modal registry
  reusing the `name:stateId` convention.
- `services/api/src/util/appealsDecision.ts` (new): `applyAppealDecision()` — the single transition. Validates the current
  status, writes `appeals` + an `appeal_events` row, performs the unban on approval, sets `silent`, and hands off delivery.
- The mod-channel post: **exactly one** embed (decision 13) with Approve / Deny / Deny silently / Ask for more info, plus an
  immediately-created thread on it (or a forum post, if `mod_channel_id` is a forum) — `mod_message_id`/`mod_thread_id` are
  stored so both are edited in place, never re-posted. Denial reason and follow-up question via modals. After a decision the
  same embed is re-rendered with a clear silent-denial label.

_Verify:_ register the interactions endpoint against a locally-tunnelled API and confirm Discord's own save-time `PING`
validation passes and that a tampered signature is rejected; run each button through to completion including the 3-second
deadline on a cold path; approve an appeal and confirm the real unban lands; deny silently and confirm the appellant's
`unban.app` view still reads "under review" while the mod embed reads denied.

### P5 — Dashboard: appeals queue, actioning, history

- `apps/website/src/app/dashboard/[id]/appeals/` gains the queue (filter by status), a detail view with the full
  `appeal_events` trail, and the same four actions.
- `services/api/src/routes/appeals/mod/*`, all calling `applyAppealDecision()` — no second implementation of the transition.
- **P4 and P5 together are decision 1.** Neither ships to users alone; the feature is announced when both are merged.

_Verify:_ take the same appeal through each terminal state from the dashboard and confirm the Discord embed updates to match,
and the reverse; confirm exactly one embed exists per appeal after a round trip through both surfaces; confirm two moderators
acting concurrently produce one decision and a clear "already decided" response for the loser.

### P6 — Decision delivery (DM), and re-adding on approval

- Delivery on decision via the user-install DM (§6, confirmed 2026-08-03), skipped entirely when `silent`; not-notifiable
  warnings on both `unban.app` and the mod embed; reachability persisted to `appeal_user_state`.
- Approval re-add (decision 14): `guilds.join` with the appellant's stored refresh token, gated on `appeals_settings
.auto_rejoin`, falling back to an invite in the DM when either side hasn't opted in or the add fails.
- The `auto_rejoin` toggle in the dashboard config section, and its appellant-side counterpart on `unban.app`.
- Optionally, `APPLICATION_AUTHORIZED` on the existing interactions endpoint as a presence accelerant (§2).

_Verify:_ approve an appeal with DMs open (i.e. the appellant authorized the Appeals user install) and confirm the DM
arrives, then with DMs closed and confirm both surfaces warned beforehand; confirm a silent denial sends nothing at all;
confirm the re-add works, and that it degrades to an invite when the guild has `auto_rejoin` off, when the appellant never
granted `guilds.join`, and when their refresh token has been revoked.

### P7 — Configurable questionnaire

- Dashboard question builder (add/edit/reorder/remove, style, required, max length) and dynamic rendering on `unban.app`.
- Additive by construction: `prompt_snapshot` means existing answers keep rendering against the prompt they were given.

_Verify:_ edit a question after appeals already exist and confirm historical appeals still display their original prompts.

### P8 — Auto-unappealable via ban-reason matching

- Per-guild patterns evaluated against the ban reason the probe already returns, at submit time and when rendering the guild.
- Dashboard CRUD, plus a preview showing what a given pattern would match.

_Verify:_ a ban whose reason matches is refused at submit with a clear message; a near-miss is not.

### P9 — Timeout appeals

- OAuth gains the `guilds` scope; discovery is the member-fetch path from §4, not the ban probe.
- `appeals.kind = 'timeout'`; approval clears `communication_disabled_until` rather than unbanning.
- Handle the punishment expiring mid-appeal — the appeal becomes moot, not approved.

_Verify:_ file a timeout appeal, approve it, confirm the timeout clears; file another and let the timeout lapse naturally,
confirming the appeal resolves as moot rather than sitting pending forever.

## Verification

Per [workflow.md](../workflow.md#verification-standard), every phase needs `turbo run build lint test` green **and** the
affected service run locally against a migrated database and a real test guild, exercising that phase's `_Verify:_` line.
Phase-specific notes on top of that:

- **P0** is the one phase with no runtime surface of its own, and therefore the one most likely to be under-verified. Its
  real test is `apps/website` behaving identically, so click through it rather than trusting the typecheck.
- **P1** needs a genuinely separate Discord application — creating one is part of the phase, not a prerequisite someone else
  provides.
- **P3/P4** need the API reachable from Discord (a tunnel) for the interactions endpoint, and two browser profiles to keep
  the two sessions honestly separate.
- **Silent denials** need explicit verification from the appellant's side, not just the moderator's, in P4 and again in P6.

## Risks and known sharp edges

- **Storing appellants' OAuth refresh tokens** is a new class of secret in this system, held for weeks, belonging to users with
  every reason to be hostile to the guilds involved. Encrypted at rest, never exposed to a guild's moderators, and worth
  deleting once an appeal reaches a terminal state and the re-add window has passed.
- **Poll staleness.** A guild that just added the bot won't appear until the next poll. The existing "Refresh server data"
  button is the user-facing answer; make sure it forces the Appeals path too.
- **Nothing in the product can force the appeal link in front of a banned user** (decision 16). The one moment they are
  guaranteed to be reachable is the ban itself, and that DM belongs to somebody else's mod bot. Appeals is structurally
  dependent on guilds pasting a link into their own ban-reason template — the `unban.app/<inviteCode>` form exists precisely
  because that dependency will often go unmet.
- **Silent denials mean the site knowingly shows a state that is not real.** That is the owner's call and the point of the
  feature, but it should be written down as a tradeoff rather than discovered later — including that the true status remains
  in the database if a user ever asks for their data.
- **Leaking a silent denial is a one-line mistake with no default test coverage.** One serializer, tested.
- **Two sessions, two applications.** The `kind` discriminator and distinct cookie names are what stop a confused-deputy
  problem here; neither is optional.
- **The 3-second interaction deadline runs inside the shared API process**, alongside dashboard traffic. Defer first, work
  second, always.
- **`unban.app` is a public form for hostile users by construction.** Rate limits, cooldowns, and `max_appeals` are the
  product's spam defense, and ban evasion via alt accounts is not solvable here — Appeals sees only the account in front of
  it.
- **`apps/appeals` needs its own Vercel project and domain.** The root `Dockerfile`, `docker-compose.yml` and
  `.github/workflows/deploy.yml` cover only `api`/`ama-bot`/`modmail-bot`; `apps/website` already deploys out-of-band and
  this will too.

## Open questions (not blocking, revisit during implementation)

1. ~~**Can a user-installed app DM the user who installed it, with no shared guild?**~~ **Resolved, 2026-08-03: yes.** Confirmed
   manually — a user install's consent screen shows "Send you direct messages" as its own line next to "Create commands", and
   a DM was actually delivered with no shared guild. §6 and decision 10 rely on this entirely; the notification guild is
   dropped rather than kept as a fallback.
2. **A silent denial that reads as "under review" forever also blocks re-appealing**, since an open appeal normally prevents
   a new submission — which makes silent denial permanent in practice, not merely quiet. Recommendation: once the cooldown
   lapses, the public view flips to a neutral "no response — you may appeal again" and a resubmission is allowed, with the
   prior silent denial plainly visible to moderators. Owner's call; does not block anything before P4.
3. Whether `appeal_ban_checks` should ever be pruned. TTL-less is the decision, but a user who appeals once and never returns
   leaves rows behind indefinitely. Probably fine; revisit if the table gets large.
4. Whether `unban.app/<inviteCode>` should accept vanity URLs and custom invite domains, or only raw `discord.gg` codes.
   `GET /invites/{code}` resolves vanities fine; the question is how much of the guessing game to take on.

## Explicitly out of scope

- **Kick appeals.** A kick leaves no durable state to discover or reverse.
- **Cross-guild "appeal everywhere" flows.** Each appeal is scoped to one guild, decided by that guild.
- **Self-serve custom Appeals instances.** #216's branded per-partner deployments stay a ModMail concept.
- **AutoModerator (`v2`) integration.** Out of scope for everything in `docs/roadmap/`, this included.
- **Appeals analytics.** The dashboard shows a queue and a history, not statistics.
- **A gateway-backed ban mirror**, for the reasons in §4.
- **A "which servers am I banned in?" list**, in any form — best-effort included. See §4.
- **Sending the ban DM ourselves** (decision 16), and by extension any promise that appellants will actually receive a link.
- **Folding Appeals into ModMail** (decision 15).
