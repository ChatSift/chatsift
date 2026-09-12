# #232 -- Appeals (ban & timeout appeals, `unban.app`, the Appeals bot)

**Tracking issue:** [#232](https://github.com/ChatSift/ChatSift/issues/232). **Depends on:** nothing that is still in flight --
M4's AMA cutover ([05-migration-cutover.md](05-migration-cutover.md)) and M5's ModMail data migration
([06-modmail-port.md](06-modmail-port.md)) are independent of this and neither blocks nor is blocked by it. **Live production
impact:** none until P3, and additive thereafter: new tables, a new Discord application, a new site. No existing product's
behavior changes at any point, and there is no data migration.

## Status: P0-P6 shipped. P7 is next

This document was written 2026-07-31 and last amended 2026-08-03, then sat unstarted for a month while the AutoModerator
port, horizontal scaling (#355), the grants refactor (#310), the Discord REST proxy and the Caddy absorption (#305) all
landed underneath it. It was re-checked against the working tree on 2026-09-08 and the sections that had gone stale were
rewritten rather than patched: §2 (guild presence) described a Redis shape that no longer exists, §3 cited a deleted file,
§4 was costed against direct-to-Discord calls, and decision 16's central premise had been overturned by AutoModerator
shipping its own ban DM. Where a superseded version is still useful as rationale it is struck through rather than deleted.

P0 (`packages/private/web-core`, shipped as #404), P1 (the Appeals bot's identity, guild presence, schema and config
API), P2 (the dashboard's Appeals section), P3 (`apps/appeals`/`unban.app`, the appellant session and the four
appellant-facing routes), P3b (punishment notices, and the appeal link inside them), P4 (the mod-channel card and the
shared decision path) and P5 (the dashboard queue) are in. An appellant can sign in, reach a guild by deep link or by
invite, and file an appeal -- a guild running AutoModerator can put the link to that in the DM its bans already send --
and moderators can approve or deny it from **either** mod surface, with an approval lifting the real ban and each surface
rewriting the other. A ban lifted by any other route closes the appeal on its own (P4b). **Decision 1 is therefore
satisfied and the feature is announceable.** P6 closed the last gap in the loop: an ordinary decision is now DMed to the
appellant, and an approval can put them straight back in the server when the guild, the account and the appeal all agree.
What is left is entirely additive -- a configurable questionnaire (P7), ban-reason matching (P8) and timeouts (P9).
`09-` is the next free roadmap
slot; 02/03/04 (M1-M3), 07 (#261) and 08 (#216) were all
consumed and deleted once their work shipped. This doc follows the same lifecycle: when the phases land, it gets **deleted**
and its durable shape is condensed into a new `## 13. Appeals (#232)` section of
[01-architecture.md](01-architecture.md), with the operator runbook (onboarding a guild) going to
[workflow.md](../workflow.md) -- the same split §8 uses today.

## Goal

Let a user who has been banned (or timed out) in a guild that uses ChatSift submit a structured appeal, and let that guild's
moderators decide on it from either Discord or the dashboard. Three surfaces, one backend:

- **`unban.app`** -- a public Next.js app under its own Discord application, where appellants log in, find the guild, answer
  the guild's appeal questions, and track status.
- **The dashboard** (`automoderator.app/dashboard/<id>/appeals`) -- guild configuration, plus a full appeals queue and history
  with the same actions available in Discord.
- **The Appeals bot** -- a Discord application with no gateway connection and no commands in user-facing guilds. It posts
  appeals into a mod channel with action buttons, and it delivers decisions to the appellant over DM. Making a banned user
  DM-reachable at all is the least obvious problem in the whole feature; §6 is about nothing else.

## Owner's decisions (2026-07-31)

Captured verbatim in intent, since several of these close off otherwise-reasonable alternatives. 12-16 came out of a PM
review on 2026-07-31 (comparison against existing appeal bots as deployed on a large server), and several of them overturn
what 1-11 originally said -- where they do, the superseded version is left visible rather than quietly edited out.

1. **Both mod surfaces ship together.** #232 was torn between "manage appeals on the dashboard via grant tokens" and "the
   dashboard is read-only, actions happen via in-Discord buttons". Neither -- both, from the start, converging on one shared
   `applyAppealDecision()` transition rather than two parallel implementations that drift.
2. ~~**The Appeals bot is HTTP-only and lives inside `services/api`.** No new service, no new container. It has no gateway
   connection, no commands in user-facing guilds, and exists on Discord's side purely as an application id, an interactions
   endpoint, and a bot token used for REST.~~
   **Superseded 2026-09-09: Appeals gets a gateway connection and its own service, `services/appeals-bot`.** What survives
   is "no commands in user-facing guilds" -- that part was never about transport. What broke is the rest: an HTTP-only bot
   has no guild list, and §2's answer to that was a poll of `GET /users/@me/guilds` whose cost is O(guilds) every 30
   seconds, forever, spent against the proxy's one global budget, to re-derive data that changes a few times a day. That is
   the same unbounded-fan-out failure mode §4 spends a page designing out, just on a timer instead of a request.
   A gateway connection with `Guilds | GuildModeration` -- both non-privileged, so no intent approval is ever needed -- gives
   the guild list for free and correctly, through the `bot-core` client every other bot already uses, and adds ban-list
   events on top. The cost is one more container, which is what the original decision was trying to avoid; that trade reads
   very differently now that avoiding it costs a permanent poll.
   **This is a simplification, not just a swap.** With interactions arriving over the gateway, the whole of §1 evaporates:
   no Ed25519 verification, no raw-body middleware pair, no API-local component dispatcher duplicating `bot-core`'s, and no
   3-second interaction deadline running inside the process that serves the dashboard. `APPEALS_PUBLIC_KEY` is gone with it.
   P4 becomes an ordinary `bot-core` component handler like every other bot has.
3. **`unban.app` is its own Next app under its own Discord application.** OAuth goes through the Appeals application, not
   ChatSift's, so a banned user is never asked to authorize something branded for a product they have no relationship with.
4. **`packages/private/web-core` gets extracted first**, before a second Next app exists to duplicate into.
5. **Ban status is discovered lazily. Never fan out on login.** See the architecture section -- this is the single decision
   most likely to be "fixed" back into a scaling failure by a future session that hasn't read the reasoning.
6. **Denials can be silent**, and a silent denial is publicly indistinguishable from a pending one: the appellant's view
   keeps reading "under review" indefinitely. Terminal and closed for moderators, invisible to the appellant.
7. **Appeal questions are per-guild configurable**, but answers store a snapshot of the prompt they were answering, so
   editing a question later never rewrites history -- and so the configurable-questionnaire phase is additive rather than a
   data migration.
8. **Bans can be marked unappealable** both manually (a per-guild user list) and automatically (patterns matched against the
   ban reason).
9. **Timeouts are appealable too**, as a later phase. They are a genuinely different shape -- the appellant is still a guild
   member and the punishment expires on its own -- so they do not get retrofitted into the ban path.
10. ~~**The notification guild is real infrastructure, not a nicety.** A bot can only DM a user it shares a guild with, and an
    appellant is by definition not in the guild they are appealing to. Without it, approvals cannot be delivered.~~
    **Superseded by §6, confirmed 2026-08-03**: a user install of the Appeals application DMs the appellant directly, no shared
    guild required. Owner tested it manually -- the consent screen shows "Send you direct messages" as its own line alongside
    "Create commands" for a user install, and a DM was actually delivered with no shared guild. The plan now relies on this
    entirely; the notification guild is dropped, not merely demoted.
11. **No self-serve custom Appeals instances.** #216's per-partner branded deployments are a ModMail concept and stay one.
12. **Discovery is a direct link or an invite code -- not a browsable list, and not your own guild list.** This supersedes the
    directory in the original draft. You cannot pick a guild you are banned from out of your own guild list, because you are
    not in it; and a public directory of every guild using Appeals is an enumeration surface nobody asked for. Entry points:
    `unban.app/g/<guildId>`, plus **`unban.app/<inviteCode>` -- swap `discord.gg` for `unban.app` in any invite you already
    have** (a trick worth copying outright: it needs no search box, no explanation, and works from a link the appellant
    already has in their scrollback).
13. **One embed per appeal, in a thread.** The mod channel is either a text channel where the bot posts a single embed and
    immediately creates a thread on it, or a forum channel where each appeal is its own post. **Never two embeds** -- this was
    the PM's specific, unprompted complaint about an existing appeal bot, and it is the kind of thing that is free to get right
    now and annoying forever if not. The embed is edited in place for the life of the appeal.
14. **Approval can re-add the user, opt-in on both sides.** The guild enables it, and the appellant must have granted
    `guilds.join`. When either side hasn't opted in, approval DMs an invite instead.
15. **Appeals stays its own Discord application rather than folding into ModMail.** Raised at the PM review as "designate an
    appeals forum in ModMail, keep the experience consistent". Rejected: decision 3's branding argument is the whole reason
    the separate application exists, and ModMail already carries custom instances (#216) and DM mode, so an appeals forum
    inside it would have to be gated out of every one of those paths. The cost of the split is one more bot in the guild list.
16. ~~**ChatSift does not send the ban DM.** Some existing appeal bots DM the user their ban reason and appeal link _before_
    banning, which is only possible for the bot issuing the ban -- and that is somebody else's mod bot. The dashboard
    surfaces the guild's appeal link for copy-paste into their existing ban-reason template instead. AutoModerator could close
    this loop natively one day; that is not this issue.~~
    **Superseded 2026-09-08: ChatSift now sends the ban DM, and Appeals rides it.** "One day" arrived while this document sat
    unstarted. AutoModerator's port landed P0 through P8 on the v3 stack, and `notifyTarget()`
    (`services/automoderator-bot/src/lib/moderation.ts`) already DMs the target with the guild name and the reason. Critically
    it fires _before_ the action for `NOTIFY_BEFORE_ACTING = ['KICK', 'BAN', 'SOFTBAN']`, which is exactly the set where the
    DM is the last chance to reach them, and it is on by default (`request.notifyTarget ?? true`). One function, one call site
    in each direction, best-effort by construction (failures log at `info`, never throw).
    So the appeal link goes in that DM, behind a per-guild setting, as **P1b** below. This is not a nicety: it is the only
    moment an appellant is guaranteed to be reachable, and the whole product is structurally dependent on it. The
    copy-paste-into-your-own-template path stays for guilds not moderated by AutoModerator, which is most of them.
    **Amended 2026-09-10 by what P3b actually shipped:** the link goes in that DM, but it is not appended behind a per-guild
    _toggle_ -- it is pasted into a per-guild punishment _notice_, one click away in the editor. The half of the original
    decision that survives is the one that mattered: ChatSift sends the ban DM, and that DM is where the link lives. See
    P3b's deviations for why an automatic append and an editable notice cannot coexist.

## Architecture

### End to end, in one pass

A guild's mods enable Appeals from the dashboard and pick a mod channel. A banned user lands on `unban.app` -- via
`unban.app/g/<guildId>` from the guild's own ban message, or by swapping `discord.gg` for `unban.app` in an invite they
already have -- logs in through the Appeals application, and the API confirms the ban with a single Discord call. They answer
the guild's questions and submit. The API writes the appeal, then posts one embed into the mod channel and opens a thread on
it, carrying Approve / Deny / Deny silently. Whichever surface the decision comes from, it funnels into one transition that
writes the row, unbans (and optionally re-adds) on approval, and -- unless the denial is silent -- DMs the appellant.

### 1. Interactions -- there is no endpoint, and there is not going to be one

**Deleted 2026-09-11, when P4 was built.** This section used to carry a full design for an Ed25519-verified
interactions endpoint in `services/api`, kept "as the record of what HTTP-only would have cost" after decision 2 was
reversed. It is gone: Appeals has a gateway, its interactions arrive through `@chatsift/bot-core`'s registry exactly like
every other bot's, and a page of instructions for building the thing we deliberately did not build is a page somebody
eventually follows.

What is worth keeping is the one line: **no interactions endpoint, no signature verification, no `APPEALS_PUBLIC_KEY`, no
API-local component dispatcher.** `services/appeals-bot/src/components/` is where an appeal button is handled.

### 2. ~~`bot:APPEALS` presence without a gateway~~ -- resolved by giving it a gateway

This is the one thing that does not work for free once you drop the gateway, and it is load-bearing: without it the dashboard
never renders an Appeals badge or section for any guild, so the feature is invisible.

The guild list (`packages/private/backend-core/src/lib/data/bots.ts`) is fed entirely by `GUILD_CREATE`/`GUILD_DELETE` and
`READY` in `packages/private/bot-core/src/lib/client.ts`. An HTTP-only bot receives none of those, so nothing would ever
publish for `APPEALS`, and `fetchMe`'s `BOTS.filter(...)` (`services/api/src/util/me.ts`) would report Appeals as installed
nowhere.

~~**Resolution: poll `GET /users/@me/guilds` with the Appeals bot token** from a `.unref()`'d interval in `services/api`
(paginated via `after`, `limit=200`).~~
**Superseded 2026-09-09.** The poll was built, ran green, and was then removed the same week -- it is the reason decision 2
was reopened. Its problem was never that it broke; it was the shape. O(guilds) Discord calls every 30 seconds, forever,
whether or not a single guild moved, spent against the budget shared with every other bot, to re-derive something the
gateway publishes for free. The cadence could not be relaxed either: `syncShardGuildList` arms each slice with a hardcoded
60-second TTL, so 30 seconds was a floor, not a choice.
`services/appeals-bot` now publishes the list through `bot-core`'s ordinary `GUILD_CREATE`/`GUILD_DELETE`/`READY` path, and
`fetchMe` picks Appeals up with no special-casing at all -- which is what the paragraph below was always really claiming,
and it is true for free once the events exist.

**Note the shape this writes into, because #355 changed it after this document was first written.** There is no longer a
`GuildList` store with a `.set()`. The list is now published _per replica_ across three key families -- `guilds:<id>:<idx>`,
`guildslive:<id>:<idx>` and `guildsreplicas:<id>` -- each carrying a **60-second TTL**, with `readGuildList(id)` unioning
across live replicas and reaping expired ones. The 10-second tick in `client.ts` is a TTL heartbeat, not a flush.

So the poll calls `syncShardGuildList('APPEALS', 0, guildIds, () => true)` against a synthetic replica index of `0` (Appeals
has no shards, so one slice is the whole deployment, and a second API replica polling the same index is idempotent), and
`dropGuildList('APPEALS', 0)` on shutdown. **Cadence must be safely under 60 seconds -- use 30.** Mirroring the 60-second
`loadInstances()` refresh, as an earlier draft of this section said, is now exactly the wrong number: at 60s the TTL races
the poll, `readGuildList` reaps the slice, and the dashboard flickers Appeals in and out for every guild. No change to
`bots.ts` is needed. `loadExperiments()` in `services/api/src/bin.ts` is the second precedent for the `.unref()`'d interval.

- **Dropped with the poll: the `APPLICATION_AUTHORIZED` accelerant.** An earlier draft suggested Discord's webhook event
  as a way to add a guild the moment the bot is invited rather than waiting out the poll interval. There is no poll left to
  accelerate, and the event would need exactly the HTTP endpoint §1 says is not being built.
- **Rejected: deriving presence from an `appeals_settings` row.** It cannot distinguish "installed but not yet configured"
  from "not installed", and the dashboard needs the first of those to render an Appeals section at all -- a guild that has
  the bot but has never opened the config screen still has one.
- **Cache-key bumping is no longer a thing to worry about.** An earlier draft called it a free win that adding `'APPEALS'` to
  `BOTS` needs no `me2:` bump. That is now moot rather than merely true: the key is `me:<sha256 of token>` (plus
  `me:scoped:<...>`), and manual version bumps were replaced wholesale by `{ versioned: true }` on the recipe, which evicts
  on `RecipeSchemaMismatchError` instead. Nobody bumps keys any more.
- **But adding `'APPEALS'` to `BOTS` is not free either.** `APIMapping` (`services/api/src/util/discordAPI.ts`) is a
  `Record<BotId, API>`, so widening `BOTS` is a **compile error** until the token and REST client land in the same commit.
  Plan them together; see P1.

### 3. Two Discord applications, two eTLD+1s

`unban.app` cannot share the dashboard's session. `cookieWithDomain` (`services/api/src/util/constants.ts`) pins cookies to
`ROOT_DOMAIN` (`automoderator.app`), a different eTLD+1, and the OAuth application is a single global pair
(`OAUTH_DISCORD_CLIENT_ID`/`_SECRET`) hardcoded by `services/api/src/routes/auth/discord.ts`. What that costs:

- New env in `packages/private/backend-core/src/lib/env.ts`: `APPEALS_BOT_TOKEN`, `APPEALS_METRICS_PORT`,
  `APPEALS_OAUTH_CLIENT_ID`, `APPEALS_OAUTH_CLIENT_SECRET`, `APPEALS_ROOT_DOMAIN`, `APPEALS_FRONTEND_URL_{DEV,PROD}`,
  `APPEALS_API_URL_{DEV,PROD}`.
  (`APPEALS_PUBLIC_KEY` was here until the gateway reversal; there is no interactions endpoint to verify signatures for.)
- **The API has to answer on a hostname under `unban.app` too** -- `api.unban.app`, added to `build/caddy/Caddyfile` as a
  second site block in front of the same container. This was missed until the flow was first exercised in production, where
  it failed as a flat `400 bad state` on every login: a `Set-Cookie` naming `Domain=unban.app` is discarded outright by the
  browser when the response came from `api.automoderator.app` (RFC 6265 5.3.6), so the `appeals_state` cookie was never
  stored and the callback had nothing to compare against. Local dev never showed it, because `IS_PRODUCTION` is false there
  and `appealsCookieWithDomain` leaves `domain` unset. Pinning the cookie to `unban.app` is the correct half of this and
  cannot be relaxed -- `apiFetchServer` reads the session cookie off the _`unban.app`_ request during SSR, so a cookie
  scoped anywhere else would render every page logged-out -- which makes the API hostname the half that had to move.
- A parallel `/v3/appeals/auth/discord` + `/v3/appeals/auth/discord/callback` pair. Scopes start at `identify` alone --
  deliberately minimal for a site whose users have no reason to trust it -- and gain `guilds` only when P9 needs it.
- A distinct cookie name (`appeals_refresh_token`) **and** a `kind` discriminator in the JWT payload, so an appeals session
  can never authenticate a dashboard route even if a cookie leaks across. Reuse the pattern, don't invent a second one --
  but note the citation this section used to carry is dead: `grantToken.ts` and its `kind: 'grant'` were deleted in #310.
  The live version of the same defense is `packages/private/backend-core/src/lib/dashboardSession.ts`, visible in use at
  `services/api/src/routes/auth/discord.ts` (`req.tokens?.access.kind === 'oauth'`).
- A second allowlisted origin in `sanitizeRedirectTo` (`services/api/src/util/redirectTo.ts`). The origin gate is still a
  single frontend origin and does need widening, but the path half is already solved: `ALLOWED_PREFIXES` gained a second
  entry (`/automoderator/report`) with P3b, so the precedent this section says needs inventing exists.
- **Appellant-facing routes must not go through `isAuthed()` at all.** This is the sharpest edge in the whole section and it
  post-dates the original draft. `services/api/src/core/server.ts` now runs `assertGuildScopedRouteGuard` at boot, which
  throws on any `isAuthed()` route with no `:guildId` that is not listed in `NON_GUILD_SCOPED_ROUTES`. The tempting fix --
  add the appeals routes to that list -- is the dangerous one, because the guard's own comment explains why the list exists:
  a `/dashboard`-minted scoped session **defaults to allowed on every `isAuthed` route**. Give appeals its own
  `isAppealsAuthed()` instead. The two session kinds are then structurally unable to reach each other's routes, rather than
  relying on a discriminator check inside a shared middleware, and the boot guard never applies.
- A widened `CORS` regex in `.env.public`.

### 4. Ban discovery -- why the obvious design is wrong

A banned user is not a guild member, so OAuth `guilds` never reveals which guilds they are banned from. The obvious answer is
to check every appeals-enabled guild at login. **Do not.**

- It is O(appeals-enabled guilds) Discord calls **per page view**. This reasoning was written when each bot talked to Discord
  directly; `services/discord-proxy` now sits in front of every REST client
  ([01-architecture.md](01-architecture.md) §11), which makes it _worse_, not better. The proxy holds one global budget
  shared across every bot, so an appeals fan-out does not merely starve itself -- it starves AMA, ModMail, Social and
  AutoModerator alongside it. Treat a burst of unbounded `Promise.all` against the proxy as the failure mode to design out,
  not a cost to absorb.
- It is also how you manufacture real invalid requests. Any guild where the Appeals bot lacks `BAN_MEMBERS` returns `403` on
  every probe, and `403` -- with `401` and `429` -- counts toward Discord's 10,000-per-10-minutes Cloudflare ban.
  (`404 Unknown Ban` does _not_ count. The reasoning above stands without it.)

**The probe primitive:** `GET /guilds/{guildId}/bans?limit=1&after=<userId - 1n>`, then `result[0]?.user.id === userId`. This
always returns `200` -- an empty array or a single entry -- so the happy path never emits a 4xx at all, and it returns the
**ban reason** in the same call, which is what P8's pattern matching consumes. Snowflake arithmetic in `BigInt`. Confirm the
`before`/`after` direction empirically in P1; guessing wrong fails closed (every banned user reads as not-banned), so it
surfaces on the first manual test instead of corrupting anything.

**Lazy by default.** Ban status is asserted once the appellant is on a specific guild (one probe) and **re-asserted
authoritatively at submit** (one more). Correctness only has to hold at submit time; everything before it is a hint.

**Two entry points, and no list at all** (decision 12):

- **`unban.app/g/<guildId>`** -- the deep link a guild pastes into its own ban-reason template or rules channel. The expected
  arrival path for most appellants, and the reason the discovery problem is usually not a problem.
- **Invite search** -- the appellant pastes a server invite and `GET /invites/{code}` resolves it to a guild id in a single
  call, which the probe then runs against. This is what makes the product usable for someone who arrived with nothing but the
  name of the server that banned them.

**No "which servers am I banned in?" list is offered, in any form.** The honest version is the fan-out this section rejects.
The dishonest version -- a best-effort list maintained in the background -- is worse than no list: it is wrong exactly when
someone relies on it, and a single blip of downtime means it can never be trusted again without the full re-sync that makes
the fan-out untenable in the first place. Showing the user their own guild list doesn't help either; by construction, the
guild they want is not in it.

**What _is_ offered, and why it is not that** (added 2026-09-10): `unban.app` shows an appellant the servers it knows they
are currently banned in -- `readKnownBans`, rendered by `KnownBansList` on both the landing page and `/appeals`. Rows come
from a probe that appellant caused or from a ban the gateway observed in a configured guild (see the supersede note above),
so the list is a suggestion and never a complete answer. It is re-established before
being shown: a row the gateway touched inside `KNOWN_BAN_TRUSTED_FOR_MS` is trusted, anything older is re-probed (capped at
`KNOWN_BAN_LIMIT`), a definite "not banned" drops the entry, and "cannot tell" keeps it. Guilds with an appeal already open
are excluded before the re-probe, so nothing is spent re-confirming a ban nobody is about to act on. The copy says "servers
you have checked" and states outright that it is not every server they are banned in -- which is the whole difference, and
the thing to preserve if this is ever touched.

One reduction to build in from the start: cache "this guild's bot lacks `BAN_MEMBERS`" negatively per guild, so a
misconfigured guild costs one `403` in total rather than one per appellant forever.

`appeal_ban_checks` survives the removal of the fan-out as a plain cache of probe results -- it gives a returning appellant
their previously-checked servers without re-probing, and it is where P8 reads the ban reason from.

~~**Rejected: a gateway-mirrored ban table.** Beyond needing the gateway process decision 2 rules out, any downtime forces a
full paginated `GET /guilds/{id}/bans` re-sync across every guild -- strictly worse than the thing it replaces, and worse in
exactly the moment you can least afford it. This is the same failure mode that makes the current production ModMail slow to
respond to a DM, roughly tripled.~~

**Superseded 2026-09-10 -- `GUILD_BAN_ADD` now inserts.** Owner's call, and the rejection above was answering a question
nobody was asking. It argued against a table you would have to _re-sync_ -- i.e. one treated as complete, where a gap is a
bug to be repaired. Nothing treats `appeal_ban_checks` that way: `readKnownBans` re-probes every row before showing it, and
`evaluateAppealEligibility` probes again at submit, so the probe is still the only authority and downtime costs a missing
suggestion rather than a wrong answer. There is no re-sync because there is nothing to reconcile against.

What it buys is the entire first-run experience. Previously an appellant had to already know which server banned them and
paste an invite before anything appeared at all -- for a product whose users arrive confused and hostile, that is a
significant ask. Now they sign in and their bans are listed. Two bounds keep this from drifting back into the thing above:

- **Only guilds with an `appeals_settings` row** are recorded. Listing a server whose appeal page answers `NOT_CONFIGURED`
  is worse than not listing it, and this also keeps growth proportional to the ban rate of _configured_ guilds rather than
  of every guild the bot sits in. An already-tracked `(user, guild)` pair is still refreshed unconditionally, so a guild
  that unconfigures does not leave stale rows behind.
- **`GUILD_BAN_REMOVE` stays `UPDATE`-only.** A row asserting "not banned" about somebody who has never used the site is
  storage with nothing on the other end of it.

The table is still permanently incomplete -- bans predating the bot's arrival in a guild, bans during downtime, and every
guild that does not use Appeals are absent -- and the appellant-facing copy says so outright rather than letting somebody
read a short list as "you are not banned anywhere else". **That copy is the load-bearing part now.** Worth noting for later:
rows now accumulate for people who may never sign in, so this eventually wants a retention sweep; none exists yet.

**P9's asymmetry:** none of this applies to timeouts. A timed-out user is still a member, so OAuth `guilds` plus a single
`GET /guilds/{id}/members/{userId}` (reading `communication_disabled_until`) answers the question with no discovery problem.

### 5. Silent denials

A silent denial is terminal and closed for moderators, while the appellant's view never changes -- the site keeps reading
"under review" indefinitely.

`appeals.status` holds the internal truth; a separate `silent BOOLEAN` marks it. The appellant-facing serializer derives a
_public_ status that maps `denied && silent` back to `pending`, and appellant-facing routes must never expose
`appeal_events`, `decided_at`, `decided_by_id`, or the decision reason under any circumstances. **That serializer is the
single choke point** -- name it, route every appellant-facing response through it, and unit-test the mapping, because a leak
here is a one-line mistake that nothing else in the stack would catch.

Two consequences to carry into later phases: P6 must branch on `silent` and send no DM, and both mod surfaces must label a
silent denial unmistakably, so a second moderator doesn't helpfully follow up and blow it.

### 6. Decision delivery -- user-install DMs

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
`unban.app`, and DM the appellant directly. This is the sole delivery mechanism -- no guild to create, no rules to enforce, no
ModMail deployment for it, no mass-adding thousands of banned users into one shared space.

**Rejected alternative: the notification guild.** The original draft's plan -- a ChatSift-owned guild with no text channels
beyond one read-only info channel, the appellant added silently via `guilds.join` at login, one rule (members may not DM each
other) enforced with ModMail -- is superseded outright now that the user-install path is confirmed, not merely kept on standby.
It is not being built. If Discord ever changes user-install DM behavior, this paragraph is where a future session should start
over, not resurrect unbuilt infrastructure sized for a different-shaped problem years later.

Delivery is still _possible_, never _certain_ -- the appellant can have DMs closed regardless of mechanism. Reachability is
probed and persisted per user (`appeal_user_state`), and both `unban.app` and the mod-side embed warn, before a decision is
made, that it probably cannot be delivered.

**Approval can re-add the user** (decision 14), and this genuinely does need `guilds.join` -- against the appealing guild,
requiring `CREATE_INSTANT_INVITE` on the Appeals bot there, gated on the guild having enabled it. Two consequences worth
naming: it needs the appellant's OAuth credentials to still be valid at decision time, which is days or weeks after they
submitted, so their refresh token has to be stored -- encrypted at rest with `encrypt`/`decrypt` from `@chatsift/backend-core`
(`lib/crypt.ts`), the same helper #216 uses for instance bot tokens. And when any side hasn't opted in, or the re-add
fails, approval falls back to DMing an invite.

**Amended at P6 (2026-09-12): there are three sides, not two.** The guild's `auto_rejoin`, the account's OAuth grant, and
`appeals.rejoin_consent` -- a box on the appeal form, ticked per appeal. The grant is a capability given once to
`unban.app` and is not a standing instruction about every server somebody is banned from, and a guild cannot consent on
an appellant's behalf; the box is the only one of the three that is this person agreeing about _this_ server.

## Data model

Following `packages/private/db/schema/schema.sql` conventions throughout: plural snake_case, `id INTEGER GENERATED BY DEFAULT
AS IDENTITY PRIMARY KEY`, snowflakes as `TEXT`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, explicitly named constraints
and indexes, and inline `--` comments carrying the semantics.

```sql
-- Per-guild Appeals configuration (#232). A row here means the guild has finished setup; the Appeals
-- bot merely being present (bot:APPEALS) is what the dashboard renders its Appeals section off instead.
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
  -- 'pending' | 'approved' | 'denied' | 'withdrawn' | 'moot' (P4b: the ban was lifted elsewhere)
  silent          BOOLEAN NOT NULL DEFAULT false,
  -- P6, decision 14's third side: the box they ticked on the form, agreeing to be put back in *this* server
  -- if it is approved. The guild half is appeals_settings.auto_rejoin and the account half is
  -- appeal_user_state.granted_guilds_join; all three have to agree or the approval DMs an invite instead.
  rejoin_consent  BOOLEAN NOT NULL DEFAULT false,
  -- The ban reason as it read when the appeal was filed, for the record and for P8's matching.
  reason_snapshot TEXT,
  -- The single embed (decision 13), where it is, and the thread/forum post it lives on, so both can
  -- be edited in place rather than re-posted. `mod_channel_id` is where the *message* is, which for a
  -- forum post is the post itself.
  mod_channel_id  TEXT,
  mod_message_id  TEXT,
  mod_thread_id   TEXT,
  decided_at      TIMESTAMPTZ,
  decided_by_id   TEXT,
  decision_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Answers, each carrying a snapshot of the prompt it answered (decision 7).
CREATE TABLE appeal_answers (... prompt_snapshot TEXT NOT NULL ...);

-- The audit trail. NEVER served to the appellant.
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

Each phase is one PR, each independently mergeable. P0-P2 ship no user-visible Appeals product at all; the first thing an
appellant can actually use arrives in P3, and the first thing a moderator can act on arrives in P4+P5 together.

### P0 -- Extract `packages/private/web-core` (shipped 2026-09-08, #404)

New `packages/private/web-core` (`@chatsift/web-core`). Zero behavior change by construction: large diff, no new surface.

**Shipped as raw `.ts`/`.tsx` behind subpath `exports`, consumed via `transpilePackages` -- no build step.** The private
siblings (`core`, `backend-core`, `bot-core`, `db`) are plain `tsc`; tsup exists here only for the npm-published
`packages/public/*`, and the root `createTsupConfig` is a single-entry ESM+CJS bundle, which is actively wrong for this
package: bundling the client components alongside `api/fetch.ts` (a live SSR branch with a dynamic `import('next/headers')`)
either drops the non-leading `'use client'` directives or hoists one banner over all of them, moving server-only code into
the client graph. Raw source sidesteps the question entirely -- Next compiles each module individually with SWC, exactly as
it does for `apps/website/src/**` today. No barrel export; subpaths only, mirroring today's `@/components/common/X` spelling
so the codemod stays mechanical.

**The boundary is narrower than "`components/common/*`".** A file moves iff it compiles inside the package with no import
back into `apps/website`, **and** it is not specific to the dashboard's session/guild domain. 22 of the 36 common components
move; the 14 that stay would each drag in `@chatsift/api`, `@/api/routes/*`, `@/hooks/*` or ChatSift branding, for surface
`unban.app` will never have. `api/` moves 8, splits `token.ts` and `queryClient.ts`, and leaves `ws.ts` and `routes/`
behind. The payoff is a frontend package with **no `@chatsift/api`** in its graph.

**Amended 2026-09-10.** This sentence also claimed "no icons, no hooks", which stopped being true the moment `unban.app`
needed the ChatSift footer: five brand icons, `useIsMounted`, `ThemeSwitchButton`, `Footer` and `SiteLogo` moved in
alongside the rest, and `apps/website/src/components/{footer,common/Logo}` are gone. The rule that actually held up is the
one at the top of this paragraph -- a file moves iff it compiles inside the package and is not specific to the dashboard's
session/guild domain -- and site chrome passes it. Keeping `@chatsift/api` out is the constraint worth defending; an icon
count never was. The navbar is the counter-example that still holds: it is built on `UserDesktop`/`AdminNavLink`/`useMe`,
so `apps/appeals` mirrors its _shape_ in its own `SiteHeader` rather than sharing a component.

**Two things fail silently here and both need explicit checks.** A lost `'use client'`, and a Tailwind `@source` miss. On
the latter: `globals.css` uses `@import 'tailwindcss' source(none)`, so package components are not scanned unless something
says so -- the package owns its own `@source` inside `theme.css`, which resolves relative to that stylesheet. And the theme
must be imported with a **bare-string** `@import`, never `@import url(...)`: only the bare form is inlined by Tailwind, and
with `url()` every `--color-*` token silently vanishes _and Tailwind's default palette comes back_, so `bg-card` dies while
`bg-black` starts working. No error either way.

**Plumbing the original draft missed:** `eslint.config.js` scopes `reactRuleset`, `jsxa11yRuleset`, `nextRuleset` and
`edgeRuleset` to `apps/**` only, so a TSX package under `packages/` gets no `react-hooks` and no `react-compiler` (an error
in this repo) until all four are widened. And `.dockerignore` must exclude the package: the root `Dockerfile` copies package
manifests by name, then `COPY packages ./packages`, then `yarn turbo run build` -- turbo would find `@chatsift/web-core` and
build it against a `node_modules` where React was never installed, failing the API and bot image. Excluding it is safe by
precedent, since `apps/website` is already in `yarn.lock` while the Dockerfile never copies `apps/` at all.

_Verify:_ `turbo run build lint test` green; run `apps/website` locally and click through dashboard → guild → each of the AMA
and ModMail sections, confirming forms submit, error banners still fire on a forced background-refetch failure, and light/dark
theming and the custom font are unchanged; diff the built page output if anything looks subtly off.

### P1 -- Appeals bot identity, guild presence, schema, config API (shipped 2026-09-08, reworked onto a gateway 2026-09-09)

- `packages/private/core/src/lib/constants.ts`: `'APPEALS'` added to `BOTS`.
- `packages/private/backend-core/src/lib/env.ts`: the seven `APPEALS_*` vars from §3; `.env.public` and
  `.env.private.example` updated.
- `services/api/src/util/discordAPI.ts`: an `APPEALS` entry in `APIMapping`. Appeals never resolves to a custom instance --
  that stays a ModMail-only concept, same as `AMA`. This is not optional bookkeeping: `APIMapping` is a `Record<BotId, API>`,
  so it does not compile until this entry exists, and it must land in the same commit as the `BOTS` widening.
- `services/appeals-bot` (new): the gateway process, on `bot-core` like every other bot -- `Guilds |
GuildModeration` intents, no commands of its own, and `lib/banEvents.ts` keeping `appeal_ban_checks` fresh. It publishes
  the guild list through the ordinary `GUILD_CREATE`/`GUILD_DELETE` path, so nothing in `services/api` does presence work.
  Wired into `Dockerfile`, `docker-compose.yml`, `build/prometheus/prometheus.yml` (port 7010) and a `dev:appeals-bot`
  script, exactly as the other four bots are.
- `packages/private/db`: every table from the data model above, one Atlas migration, kanel regen, types exported.
- `services/api/src/routes/appeals/config/{getConfig,updateConfig}.ts` + the manual unappealable-user CRUD; registered in
  `app.ts` and re-exported from `services/api/src/index.ts`.
- `services/api/src/util/appealsBans.ts` (new): the `limit=1&after` probe, the negative `BAN_MEMBERS` cache, and the
  `appeal_ban_checks` read/write helpers.

_Verify:_ boot `services/appeals-bot` against the new application and confirm `bot:APPEALS` populates in Redis at READY and
tracks the bot being kicked from a test guild; confirm `/v3/auth/me` starts reporting `APPEALS` in `bots` for that guild;
ban and unban a test account and confirm `appeals_ban_events_total` moves, which is the only proof the `GuildModeration`
intent is actually delivering; probe a known-banned and a known-not-banned user against a test guild and confirm both
return `200` and the right answer; confirm the direction of `before`/`after` empirically here rather than trusting the docs.

**What landed differently from the plan above, and why.** Four things:

- **The guild-list poll is gone; `services/appeals-bot` replaced it.** P1 first shipped the poll §2 originally specified,
  then removed it two days later -- see decision 2 and §2 for the full reversal. `util/appealsPresence.ts` no longer
  exists; presence comes from `bot-core`'s gateway client like every other bot's. (The poll had a second problem worth
  recording, since it is what made the reversal obvious: `dropGuildList('APPEALS', 0)` could not be implemented at all,
  because every API replica published into the same synthetic index, so one replica exiting would have yanked the slice
  out from under every sibling. A presence mechanism whose shutdown path is unimplementable is a mechanism fighting its
  own substrate.)
- **`apps/website/src/utils/bots.tsx` came forward from P2.** It is `satisfies Record<BotId, ...>`, so widening `BOTS`
  does not compile until the entry lands -- the same compile-order constraint §2 already names for `APIMapping`. The
  dashboard consequence is that a guild with the Appeals bot installed gets a nav tab pointing at a route P2 has not
  built yet; harmless while the bot is in no production guild, and the first thing P2 closes.
- **The questionnaire is seeded on the first config save**, from `DEFAULT_APPEAL_QUESTIONS` in `@chatsift/core`, rather
  than left empty until P7. Same end state, one fewer migration: every guild has real `appeal_questions` rows from day
  one, so P7 is plain CRUD over them instead of having to invent history for guilds configured before it shipped. The
  seed keys off the questionnaire being empty rather than the settings row being new, which makes it idempotent and
  self-healing.
- **The env split is four vars public, two private.** `APPEALS_ROOT_DOMAIN`, `APPEALS_OAUTH_CLIENT_ID`,
  `APPEALS_FRONTEND_URL_{DEV,PROD}` and `APPEALS_METRICS_PORT`/`APPEALS_SHARDS_PER_REPLICA` are in `.env.public` for the
  same reason the dashboard's client id is; only the bot token and the OAuth secret are private.
- **Ban-list events prime `appeal_ban_checks`, and are restricted to `UPDATE`.** `services/appeals-bot/src/lib/banEvents.ts`
  never inserts a row. That one restriction is what keeps the table the cache-of-probes-we-ran its schema comment
  describes, instead of quietly becoming the gateway-mirrored ban index §4 rejects -- inserting would mean a row for every
  ban in every installed guild, forever, mostly for people who never appeal, and it would _still_ be incomplete, since a
  ban predating the bot's arrival produces no event. An incomplete table that reads as authoritative is worse than none.
  The probe stays the authority; this only keeps answers we already have fresh. `GUILD_BAN_ADD` also carries no reason, so
  a primed row clears `ban_reason` rather than keeping a previous ban's -- P8 matching on a stale reason would be a
  correctness bug, and the probe re-fills it at submit.

**Metrics, and the counting trap it hides.** `appeals-bot` publishes `discord_guilds` for free like every other bot, which
answers _how many servers is Appeals installed in_. That is **not** the same question as _how many servers accept
appeals_ -- a guild can have the bot and no `appeals_settings` row, which is exactly what a guild looks like before
anybody has picked a mod channel.
Do not put them on one panel, and do not derive the second from a gauge exported by `services/api`: every API replica
would export the same DB-derived number and `sum()` would silently return N times the truth, unlike `discord_guilds`,
which is safe to sum only because replica slices are disjoint. A row count belongs in postgres-exporter, which is already
in the stack and exports once regardless of replica count.

**Operational note for the deploy.** Every `APPEALS_*` var is required, matching every other bot token, and
`backend-core`'s `env.ts` parses eagerly at import -- so `services/api` **and every bot** refuse to boot until the host's
`.env.private` carries them. Add them before pulling this.

### P2 -- Dashboard: Appeals config section (shipped 2026-09-10)

- `apps/website/src/app/dashboard/[id]/appeals/{page.tsx,config/page.tsx}` + `_components/`, following the ModMail config
  section's shape exactly (server page = crumbs + heading + `RefreshServerDataButton`, one client form beneath it).
- Manual unappealable-user list with add/remove, modeled on the ModMail blocks list.
- `apps/website/src/utils/bots.tsx` and the dashboard section-card loop gain the Appeals entry.
- `queryKeys.appeals.*` in `api/queryClient.ts`; hooks in `api/routes/appeals.ts` deriving types via `InferRouteContract`.
- The question set is the built-in default and is displayed read-only. P7 makes it editable.

_Verify:_ with the bot in a test guild but no `appeals_settings` row, the Appeals section renders and its config screen
shows the column defaults with an empty mod channel; saving requires a channel, survives a reload, and rejects a mod
channel in another guild.

**What landed differently from the plan above, and why.** Four things:

- **The unappealable list is its own route, not part of the config page.** The plan's file list named two pages; a
  guild-scoped list edited a row at a time next to a settings form is two screens everywhere else in this dashboard
  (ModMail's blocks, AutoModerator's allowlists), and it already has its own realtime channel
  (`appealsUnappealableUsersChannel`) precisely so the two don't invalidate each other. So there is a third page, and
  `utils/appealsSections.ts` -- the same single-source arrangement `automoderatorSections.ts` uses, so the hub and the
  breadcrumb's section dropdown can't drift.
- ~~**The hub is a client component, unlike every other bot's.**~~ **Reverted 2026-09-10, see the note below.** It
  originally rendered a setup CTA instead of the section list while `settings === null`, on the reasoning that offering
  "Unappealable Users" for a server that accepts no appeals is offering an exception to a rule that isn't running.
- **`allow_timeout_appeals` is deliberately not on the form.** The column exists and the API accepts it, but nothing
  can appeal a timeout until P9, so a toggle for it would be a setting that visibly does nothing. It gets its control
  when it gets its feature -- which is also why the omission is not a stopgap: P9 adds both together.
- **`listUnappealableUsers.ts` now resolves `created_by_id` as well.** P1 returned the moderator as a raw snowflake,
  which is the one thing an audit line cannot be. It goes through the same cached `resolveDiscordUser` the subject
  already used, and the raw `createdById` stays alongside it because that is the handle that keeps working once the
  account is gone.

**The setup CTA was removed on 2026-09-10, and the idea behind it was shelved rather than dropped.** Owner's call, once
P3 made the feature real enough to click through: a screen reading "Appeals isn't set up yet" is disconnected from how
every other bot's section behaves, and Appeals is not special enough to earn its own shape. So:

- The hub is an ordinary server component listing `APPEALS_SECTION_LIST`, exactly like ModMail's and
  AutoModerator's -- including for a guild that has never configured anything.
- `appeals/config/getConfig.ts` answers an unconfigured guild with the shape a fresh row would have
  (`AppealsConfigSettings`, `modChannelId: null`) rather than `settings: null`, mirroring
  `modmail/config/getConfig.ts`. Nothing on the dashboard branches on being configured any more, and the form's
  "Set Up Appeals" button is just "Save Changes".
- **What did _not_ change, and must not:** a row in `appeals_settings` still means "this guild accepts appeals", and
  that is what `evaluateAppealEligibility` reads to answer `NOT_CONFIGURED` on `unban.app`. The defaulted shape above
  is the dashboard's view of the config, not an answer to that question -- `modChannelId` being `NOT NULL` is what
  keeps the two in step, since a row cannot exist without one. Do not re-derive "accepts appeals" from the config
  response on the frontend, and do not make the column nullable to tidy the type.

**The shelved idea, worth picking up for every bot at once.** What the CTA was reaching for is a guided
walk-through of a bot's must-dos before it works -- invite it, grant the permissions it needs, pick the one channel
it cannot run without. That is a real gap and it is not Appeals-specific: AMA, ModMail, Social and AutoModerator all
have some version of "configured enough to actually do anything" that the dashboard currently never states. Doing it
once, generically, is worth more than four bespoke CTAs. Not scheduled; no issue filed yet.

### P3 -- `apps/appeals` / `unban.app` (shipped 2026-09-10)

- `apps/appeals`: new Next app on `@chatsift/web-core`. Covered by the existing `apps/*` workspace glob, the generic turbo
  `build` task, and the eslint `apps/**` globs -- no root config changes beyond its own `package.json`/`next.config.mjs`/
  `tsconfig*.json`/`postcss.config.js`.
- `services/api/src/routes/appeals/auth/{discord,discordCallback}.ts`: the parallel OAuth pair from §3, with
  `identify applications.commands guilds.join` and `integration_type=1` (user install -- §6 for what each scope buys),
  `appeals_refresh_token` cookie, `kind` discriminator in the JWT, `APPEALS_ROOT_DOMAIN` cookie domain. The appellant's own
  refresh token is persisted encrypted to `appeal_user_state` here.
- `services/api/src/util/redirectTo.ts` and the `CORS` regex widened for the appeals origin.
- Site: `/g/<guildId>` and `/<inviteCode>` (decision 12) -- **no directory, no guild list** -- then the probe result, the submit
  form, and the public status view.
- `services/api/src/routes/appeals/{resolveInvite,checkGuild,submitAppeal,listMyAppeals}.ts`. `resolveInvite` is a single
  `GET /invites/{code}` mapped to a guild id, refusing codes for guilds with no `appeals_settings` row. `submitAppeal`
  re-probes the ban authoritatively, enforces cooldown / `max_appeals` / unappealable, and writes answers with their
  `prompt_snapshot`.
- Route-shape care: `/<inviteCode>` is a catch-all at the site root, so it has to lose to every real route (`/g/...`, auth
  callbacks, static assets) and 404 cleanly on anything that isn't a live invite.
- The appellant-facing serializer from §5 lands here, before there is any way to produce a silent denial -- so the mapping is
  in place and tested by the time P4 can create one.

_Verify:_ log in on `unban.app` locally with a second Discord application and confirm the dashboard session on
`automoderator.app` is untouched and vice versa; confirm an appeals cookie is rejected by a dashboard route; confirm the
consent screen shows both "Create commands" and "Send you direct messages" for the user install, matching the manual test
behind §6; reach a guild both by deep link and by pasting an invite, including an invite for a guild that doesn't use Appeals
and an expired one; submit an appeal end to end for a real banned test account; confirm submit is refused for a user who is
not actually banned, for an unappealable user, and inside the cooldown window.

**P3 deviations from the above, and the decisions taken while building it.** All of these read as omissions or as
things to "finish" if you follow the file list literally.

- **The appeals session carries no Discord credential at all.** `util/appealsTokens.ts` mints a pair that is
  `{ kind, refresh, sub }` and nothing else -- no embedded access token, therefore no rotation, no coalescing,
  and no `invalid_grant` handling, so none of `isAuthed`'s machinery (or #384's `invalid_client` trap) has a
  counterpart here. It can be that small because an appeals session grants no authority beyond this user's own
  appeals, and `sub` was established once by an authorization code Discord itself validated. The appellant's
  refresh token still gets stored, encrypted, in `appeal_user_state` -- but as _a credential for a later
  action_ (decision 14's re-add, weeks out), deliberately in a different place from the session. Do not
  "restore" a Discord token to the JWT.
- **`isAppealsAuthed` is a separate middleware, not a `kind` check inside `isAuthed`** -- §3 called for this and
  it is worth restating, because the shortcut is one line. The two share no code path: `isAuthed` only reads
  `refresh_token`, this only reads `appeals_refresh_token`, and neither writes the property the other reads
  (`req.tokens` vs `req.appellant`). `assertGuildScopedRouteGuard` therefore never fires for an appeals route,
  and `NON_GUILD_SCOPED_ROUTES` stays untouched. Both crossings are covered in
  `middleware/__tests__/isAppealsAuthed.test.ts`, in both directions.
- **`appearsOpenToAppellant` exists alongside `isAppealOpen`, and every appellant-facing refusal uses the
  first.** This is the non-obvious half of decision 6. A silent denial is closed and is _not_ covered by
  `appeals_open_per_user_idx`, so without this the appellant could file again -- and the cooldown check would
  then tell them, in so many words, that a decision had been made. Refusing with the same "you already have an
  appeal under review" is what keeps a silent denial silent past the moment it is made. It derives from
  `toPublicAppeal`'s own mapping rather than restating it, so the two cannot drift.
- **One eligibility ladder, `util/appealsEligibility.ts`, shared by `checkGuild` and `submitAppeal`.** The
  order of its checks is load-bearing and commented as such: settings, then their own open appeal, then the
  probe, then unappealable/ceiling/cooldown. Reordering it either spends a Discord call on a guild we do not
  serve or tells a passer-by something about a guild's unappealable list.
- **Submit is `POST /v3/appeals/guilds/:guildId/appeals`, and answers are addressed by question id**, not by
  position. P7 editing a questionnaire between the form rendering and the appellant pressing submit would
  otherwise silently re-point every answer at whatever question now sits at that index -- and write the wrong
  `prompt_snapshot` for the life of the appeal.
- **The app is client-rendered throughout; there is no `prefetch()` anywhere in it.** `web-core`'s
  `apiFetchServer` now reads whichever of the two session cookies is present rather than `RefreshTokenCookie`
  by name, so the SSR path is correct for either app if one is ever added -- it needs no configuration because
  the cookies are pinned to different eTLD+1s and a browser only ever carries one.
- **`unban.app` has no GlitchTip project yet, so `app/error.tsx` does not call `reportError`.** The dependency
  is declared (the module graph reaches it through `web-core`'s query client, where it no-ops uninitialized),
  but wiring `withSentryConfig` before the project exists would only look like coverage. Creating the project
  and adding the DSN is an operator follow-up, not a code one.
- **Not done here, and owed before this is reachable in production:** a Vercel project for `apps/appeals`
  pointed at `unban.app`, the Appeals application's redirect URI registered as
  `<APPEALS_API_URL>/v3/appeals/auth/discord/callback`, and `APPEALS_OAUTH_CLIENT_ID`/`_SECRET` filled in per host.
  Nothing in the repo can do any of those. `<APPEALS_API_URL>` and not `<API_URL>`: the two were the same value when this
  was written, which is exactly the assumption that produced the `400 bad state` outage -- see decision 3.

### P3b -- Punishment notices, and the appeal link inside them (shipped 2026-09-10)

Decision 16 as superseded, and then superseded again while building it: the link does not ride the ban DM
automatically, it rides a **punishment notice** the guild writes, and the dashboard makes pasting the link into
one a single click. The reason is in the deviations below.

- `automoderator_punishment_notices (guild_id, scope, content)` plus `automoderator_notice_scope`
  (`DEFAULT | WARN | MUTE | KICK | SOFTBAN | BAN`): free text a guild appends to the DM the bot already sends
  when it punishes somebody. `DEFAULT` is the notice every action falls back to; a row for an action replaces
  it.
- `services/automoderator-bot/src/lib/punishmentNotice.ts`: one query for both candidate rows, appended by
  `notifyTarget()`. Best-effort in exactly the way `notifyTarget` is -- a lookup that fails sends the DM
  without the notice rather than losing the DM, and the composed message is clamped to Discord's 2000.
- `services/api/src/routes/automoderator/punishmentNotices/*`: `GET` and a declarative `PUT` that replaces the
  guild's whole set inside one transaction. Both answer `appealLink` alongside the notices --
  `unban.app/g/<guildId>` when the guild has an `appeals_settings` row, `null` when it does not.
- `apps/website/.../automoderator/punishment-notices`: the general box plus one per action that DMs. Under the
  ban box, the two Appeals states: a copy-and-insert affordance with a tooltip when the guild takes appeals,
  and an upsell pointing at `appeals/config` when it does not.
- The Appeals config section surfaces the same link (`AppealLinkCopy`), for guilds not on AutoModerator.

_Verify:_ write a general notice and confirm it lands on a warn DM and a ban DM; override the ban and confirm
the general one is replaced rather than appended to; clear a box and confirm the row is gone; ban a test
account in a guild with Appeals configured and confirm the DM carries a link that opens the right guild's
appeal form, before the ban lands rather than after; point the bot at a database where the notices table errors
and confirm the DM still arrives.

**P3b deviations from the above.**

- **The link does not append itself.** The plan had `notifyTarget()` looking up `appeals_settings` and adding
  the link to every ban DM in a guild that takes appeals. What shipped is a notice the guild writes, with the
  link one click away in the editor. Automatic-and-editable cannot both be true: a guild that pastes the link
  into its own notice would have got it twice, and the only ways out are a suppression toggle nobody asked for
  or an editor that silently rewrites what was typed. This also answers the phase's own worry about linking
  into a guild that has not configured Appeals -- an unconfigured guild is offered no link to paste.
- **The notice is general, not ban-only, and per-action.** Wider than #232 needs on purpose: "what does the bot
  say when it punishes somebody" is an AutoModerator gap of its own (legacy had no answer either), and the
  appeal link is the first thing a guild wants to put there rather than the only one.
- **A per-action notice replaces the general one; it does not stack with it.** Alternatives, not layers, so a
  ban notice carrying appeal instructions does not have to restate the general text -- and the editor can say
  what an empty box does in four words ("uses the general notice").
- **`automoderator_notice_scope` is its own enum rather than `automoderator_case_action`.** The value set
  differs in both directions: it needs `DEFAULT`, which is not an action, and it must not offer UNMUTE or UNBAN,
  neither of which ever DMs (every call site passes `notifyTarget: false`). Do not "unify" the two.
- **`appealLink` is answered by the API, not built by the dashboard.** The origin is the API's
  `APPEALS_FRONTEND_URL`; a `NEXT_PUBLIC_` copy in the dashboard's environment would be a second place to get
  the domain wrong, which is what decision 3 is a monument to. `null` doubles as "this guild does not accept
  appeals" -- the `appeals_settings` row, the same predicate `evaluateAppealEligibility` uses, and not
  something to re-derive from `modChannelId` on the client.

### P4 -- The mod-channel card, the three buttons, the shared decision path (shipped 2026-09-11)

What shipped, against a bullet list that still described the HTTP-interactions version of this phase:

- **`packages/private/core/src/lib/appealEmbeds.ts`** -- the card. One embed (decision 13), the guild's whole
  questionnaire as fields, and three buttons whose custom-id prefixes live here rather than in the bot, because the API is
  what posts them. Answers are code-fenced through the same `fence()` neutralizer a reported message gets: an appeal answer
  is prose typed by somebody with every motive to dress their text up as the bot's. `truncate`/`fence` moved to a new
  `discordText.ts` in the same package, which removed the second copy of `truncate` that was already there.
- **`packages/private/backend-core/src/lib/data/appeals.ts`** -- the spine, shared with P5 exactly as
  `automoderatorReports.ts` is shared with the API. `applyAppealDecision()` is the one transition: compare-and-swap out of
  `PENDING` (**the claim is the mutex**, not a check beforehand), then the injected side effect, then the `appeal_events`
  row. The side effect is a `perform` callback rather than something each surface does around the call, because the
  ordering is the part that matters -- a throw gives the claim back and the appeal stays open, so an approval whose unban
  Discord refused can never sit there telling P6 to DM somebody that they may come back.
- **`services/api/src/util/appealCard.ts`** -- posts the card when an appeal is filed, after the transaction commits, and
  never throws: the appellant has already been told their appeal went through, because it did. Forum channel gets one post
  per appeal; a text channel gets one message with a thread opened on it immediately.
- **`services/appeals-bot/src/components/{appealApprove,appealDeny,appealDenySilent}.ts`** plus `lib/appealCard.ts`,
  `lib/appealComponents.ts`, `lib/appealDecisions.ts`, `lib/appealDenyFlow.ts`. Ordinary `bot-core` component handlers.
  Gated on **Ban Members**, because approving performs a real unban and a moderator who could not lift the ban by hand
  should not be able to lift it through a button.
- `appeals_decisions_total{decision,outcome}` in the bot's registry. `outcome="failed"` is the alert-worthy value: every one
  of those is an appeal a moderator believes they approved.

**Three buttons, not four. "Ask for more info" is cancelled, not deferred** (owner's call, 2026-09-11). The follow-up
question would have lived in `appeal_events`, which no appellant-facing route reads -- so the appellant could never have
seen it, and there was no path for an answer to come back. The `NEEDS_MORE_INFO` status and the `INFO_REQUESTED` /
`INFO_PROVIDED` event kinds went with it, in a hand-written migration (postgres cannot drop an enum value, so both types are
recreated). Nothing had ever written any of the three. Do not add the button back without designing the appellant's half
first.

**The card's "View in dashboard" button points at a page P5 built**: `appealDetailLink` (in
`dashboardLinks.ts`) resolves to `/dashboard/<guild>/appeals/queue/<id>`, nested under the list rather than
sitting as a catch-all beside `appeals/config` and `appeals/unappealable-users`. That was the one place P4
depended on P5, and decision 1 had them shipping together anyway.

_Verify:_ `build`/`lint`/`test`/`format:check` green. Runtime is the owner's: file an appeal against a text-channel mod
channel and a forum one, approve it and confirm the unban lands, deny one and confirm the card rewrites in place rather than
posting a second embed, deny one silently and confirm `unban.app` still reads "under review", and have two moderators click
opposite buttons on one card to see the loser told somebody else got there first.

### P4b -- A ban lifted elsewhere closes the appeal (shipped 2026-09-11)

Raised by the owner the day P4 landed: an appellant unbanned by some path other than the appeal -- by hand, by
AutoModerator's expired-ban sweep, by another bot entirely -- left the appeal `PENDING` forever.

The limbo is the mild half. `evaluateAppealEligibility` refuses a new appeal on an open one **before** it probes
the ban, so the stale row locks that user out of appealing in that guild ever again, including for a future ban
they have not received yet, and eats one of their `max_appeals` attempts on the way.

- **`appeal_status` gains `MOOT`**, and `appeal_event_kind` with it. Terminal, `decided_at` set,
  `decided_by_id` NULL -- the same shape as a withdrawal, because neither is a decision anybody made.
  `GUILD_BAN_REMOVE` carries no actor and attributing one would need the audit log, so the card says the ban was
  lifted elsewhere and names nobody.
- **`services/appeals-bot/src/lib/banEvents.ts` closes it**, reusing `applyAppealDecision` with `moderator:
null`. The handler already existed for the probe cache; the two jobs share an event and nothing else, so they
  get separate `try`s.
- **It can never catch our own approvals**, and that falls out of P4's ordering rather than a check: the claim
  commits before the unban call, so by the time the gateway echoes the unban back the appeal is already
  `APPROVED` and `getOpenAppeal` finds nothing. Moving the claim after the unban would turn every approval into
  a race with this handler.
- **`getOpenAppeal` is scoped to `PENDING`, not to `appearsOpenToAppellant`.** A silent denial looks open to the
  appellant and is terminal; closing one as moot would overwrite a decision a moderator deliberately made.
- The appellant sees "No longer banned", styled neutrally rather than like an approval -- nobody approved it,
  and saying otherwise claims a decision that was never taken.

**Two migration files, not one.** Postgres refuses to reference a freshly added enum value from the same
transaction (`unsafe use of new value "MOOT"`, 55P04) and Atlas runs one transaction per file, so the `ADD
VALUE`s and the `appeals_decision_check` arm that uses them are split. Worth knowing before the next enum value
anybody adds.

_Verify:_ `build`/`lint`/`test`/`format:check` green. Runtime is the owner's: file an appeal, unban the account
by hand, and confirm the card rewrites itself to closed and the appellant can file again after a future ban.

### P5 -- Dashboard: appeals queue, actioning, history (shipped 2026-09-11)

What shipped, against the bullet list this section used to carry:

- **`services/api/src/routes/appeals/mod/{listAppeals,getAppeal,decideAppeal,util}.ts`** -- the queue
  (`GET .../appeals/queue`, cursor-paginated, filterable by status and by user id), the detail
  (`GET .../appeals/queue/:appealId`, answers plus the whole `appeal_events` trail with its actors resolved) and
  the one action (`POST .../appeals/queue/:appealId/decision`). The transition is `applyAppealDecision()` exactly
  as P4 uses it, `perform` carrying the API's own unban -- there is no second implementation, which is decision 1.
- **`syncAppealCard` in `services/api/src/util/appealCard.ts`**, next to P4's `postAppealCard` and sharing a
  `buildCardBody` with it, so a decision taken on the dashboard rewrites the Discord embed and a decided card
  cannot end up missing something the fresh one had. Same `UnknownMessage`/`UnknownChannel` self-heal the bot
  does. Never throws: the decision is already committed, so a stale card next to a correct database is the
  honest degradation.
- **`apps/website/.../appeals/queue/{page.tsx,[appealId]/page.tsx}`** plus `_components/`: the list with its
  status filter and user-id search, and the detail with the ban-reason snapshot, the questionnaire, the trail and
  `AppealDecision` -- one `SegmentedControl` for the three decisions, a reason box on the two denials, and a
  `ConfirmModal` before any of them lands. Both subscribe to `appealsQueueChannel`, which was already published
  to by the submit path and every decision, so the queue was live from its first render.
- **The detail page is the `CaseDetail` shape**, not a single stacked column: `lg:flex-row` with the subject,
  the questionnaire, the decision and the trail in the main column and a `lg:w-80` sidebar of short `Field`s
  (Filed, Closed, Decided by, the Discord message link) plus an `OtherAppeals` block mirroring `OtherCases`.
  A first pass got this wrong in three ways the owner caught on sight, and all three are the same mistake --
  building the page from scratch instead of from the section next door:
  **(a)** it stacked one column, which looked nothing like any other detail page; **(b)** it rendered accounts
  three different ways on one screen (a `UserBadge` for the appellant, a bare `snapshotUserLabel()` for the
  decider, another for each event actor), so the same rule produced `char.lyy` with an id under it in one place
  and a naked `Char` in another; and **(c)** it labelled the Discord jump link "Copy link to the card in
  Discord", where _card_ is a word out of this document that no moderator has ever seen.
- `appeals_decisions_total` gained a **`source`** label and a `services/api` half (`dashboard`); the bot now
  passes `card` for its buttons and `system` for P4b's moot close. Without that the alert on `outcome="failed"`
  -- every one of which is an appeal a moderator believes they approved -- would have had a blind spot for any
  guild that triages on the web, which is the same reasoning `core/metrics.ts` already records for AMA.

**Four calls worth keeping:**

- **The decision route is gated on Manage Guild, not the card's Ban Members.** Deliberate: Manage Guild is what
  lets somebody configure Appeals, and grant themselves Ban Members, in the first place -- a stricter gate here
  would be a speed bump rather than a boundary. What the two surfaces must agree on is the _decision_, and they do.
- **The body is one `decision` discriminator (`approve`/`deny`/`deny_silent`), not `status` + `silent`.** Those
  two can be combined into states `appeals_silent_check` then refuses, and there is no reason to let a client
  construct one. **An approval carries no reason and the route refuses one**: the card has no reason box on
  Approve, and P6 DMs a non-silent decision's reason, so accepting one would put text in front of an appellant
  that only one of the two surfaces could ever produce. Both rules, and the schema mirroring `appeal_status`
  exactly, are covered by `routes/appeals/__tests__/schemas.test.ts`.
- **The decision route declares no `realtimeChannel`.** `applyAppealDecision` publishes to `appealsQueueChannel`
  itself, because the bot's buttons need that broadcast too; declaring one here would double every invalidate.
- **Nothing after the claim may fail the request**, and PR review found three places that could. The unban is
  committed and terminal by then, so an error there tells a moderator their decision failed when it landed --
  and their retry answers `409 somebody else decided this first`, blaming a person who does not exist. All
  three were the same shape, a lookup or a write whose failure nobody had costed: resolving the _moderator's
  own_ account for the audit-log reason (`resolveDiscordUser` only swallows a 404, and `/users/@me` is
  deliberately outside `fetchUserCached`, so a moderator's first decision is a real cache miss); resolving the
  accounts for the response body; and `setAppealModMessage(id, null)` in `syncAppealCard`'s own error path,
  which sat outside its `try` and so could break the "never throws" contract its doc comment states. The bot's
  twin `syncAppealCard` had that third one identically and was fixed with it.
- **`UserBadge`/`userDisplay` moved to `apps/website/src/components/dashboard/`** out of
  `automoderator/_components/`. Nothing in them was ever AutoModerator's, and an appeals page reaching into
  another bot's `_components` is the alternative.
- **Every account on these pages has its avatar beside it**, and there is exactly one way to render one: a
  `UserBadge` (avatar, name, id) wherever there is room, and an avatar-plus-name header in the trail, shaped
  like #261's `MessageAuthorHeader`. A `MOOT` event is drawn as the bot (`FaRobot` on `misc-system`) rather than
  as a blank, so no row ever reads as an actor we failed to resolve. `Decided by` on a withdrawal and on a moot
  close say _which_ nobody it was, for the same reason.

_Verify:_ `build`/`lint`/`test`/`format:check` green. Runtime is the owner's: take the same appeal through each
terminal state from the dashboard and confirm the Discord embed updates to match, and the reverse; confirm exactly
one embed exists per appeal after a round trip through both surfaces; confirm two moderators acting concurrently
produce one decision and a clear "already decided" response for the loser; and confirm the card's "View in
dashboard" button now lands on the detail page rather than 404ing. Worth a look on a phone too -- the two-column
detail collapses at `lg`.

### P5b -- A re-banned appellant starts clean (shipped 2026-09-11)

Found by the owner while exercising P5: an account that appealed, **was approved, and was then banned again**
opened `unban.app` to find its previous appeal captioned "Your appeal -- Approved", its attempts already spent,
and "You cannot appeal again yet ... try again on October 11" counting down from a decision about a ban that no
longer existed.

The cause is that `appeals` has no column naming the ban an appeal is about, so the ladder scoped everything to
`(guild_id, user_id, kind)` -- the appellant's whole history in that guild, forever. There is nothing to key on
either: Discord's ban object carries no id and no timestamp, and the audit log needs a permission Appeals does
not ask for.

What there is instead is a **boundary**. An appeal that ended with the ban being _lifted_ -- `APPROVED` (the
unban the approval performed) or `MOOT` (P4b's ban lifted elsewhere) -- cannot be about a ban the account is
under afterwards. So `appealsForCurrentPunishment` (in `util/appealsPublic.ts`, beside the other appeal
predicates and unit-tested with them) takes the history newest-first and returns everything above the most
recent such appeal. `evaluateAppealEligibility` scopes `appealsUsed`, the cooldown and `latestAppeal` to that
slice, and since `submitAppeal` shares the ladder the fix holds at write time too.

Two details worth keeping:

- **`DENIED` and `WITHDRAWN` are not boundaries.** The ban stands after both, so the cooldown they start
  belongs to it -- and without that, withdraw-and-resubmit would be a way around the cooldown entirely.
- **Where the appellant is not banned, `latestAppeal` still falls back to the appeal that ended their last
  ban.** For somebody checking back after an approval that is the whole story, and dropping it would have
  traded this bug for a blank page. Only a _current_ ban is never captioned with an old appeal's verdict.

This also makes the copy true: `BlockedNotice`'s `MAX_APPEALS` has always said "this server limits how many
times **the same ban** can be appealed", and the ceiling was specified per (user, punishment) in the data model
from the start. This is the part that was missing, not a change of rule.

**Known gap, not closed here:** denied, then unbanned _by hand_, then banned again. No `APPROVED`/`MOOT` row
exists, so the old cooldown still applies to the new ban. Closing it needs a durable "this ban was lifted at T"
fact, and there is nowhere to put one -- `appeal_ban_checks.checked_at` is overwritten by every probe, and
P4b's `GUILD_BAN_REMOVE` handler only ever touches a `PENDING` appeal (deliberately: it must not overwrite a
silent denial). That is a schema decision, and an owner call.

_Verify:_ `build`/`lint`/`test`/`format:check` green, with the boundary covered by six cases in
`util/__tests__/appealsPublic.test.ts`. Runtime is the owner's: re-ban an account whose appeal was approved and
confirm `unban.app` offers a fresh form with no old appeal above it, then confirm an account denied and still
banned is _unchanged_ -- it must keep both its cooldown and its spent attempts.

### P6 -- Decision delivery (DM), and re-adding on approval (shipped 2026-09-12)

The decision now reaches the person it is about. Both mod surfaces deliver, converging on one
`deliverAppealDecision()` in `@chatsift/backend-core` exactly as they already converge on one
`applyAppealDecision()` -- and for the same reason (decision 1): a denial that reads differently depending on
which button a moderator happened to be near is the drift that decision exists to prevent.

**Consent is three-sided, not two.** The original plan had the guild's `appeals_settings.auto_rejoin` and the
appellant's OAuth `guilds.join` grant. A third side was added on the owner's call (2026-09-12): **a box on the
appeal form itself**, `appeals.rejoin_consent`, reading _"If the moderators of this server choose to, I consent
to being automatically re-added to the server if my appeal is accepted."_ The OAuth grant is a capability given
once to `unban.app` and says nothing about which of the servers somebody is banned from they actually want to
be returned to; the guild's toggle is the guild's preference and cannot consent on anybody's behalf. All three
have to agree, and **the box is the appellant-side counterpart** P6 originally left unspecified -- there is no
separate account-level toggle, because the question is per server and per punishment.

Existing rows default `false`, which is the right default for a consent nobody was asked for: appeals filed
before this shipped fall back to the invite.

What landed:

- **`appeal_user_state.dm_reachable` is written from attempts, never from probes.** There is no probe: opening a
  DM channel succeeds whether or not a message would be accepted. The one thing a _login_ establishes is an
  authorization that declined the user install, which has no DM path at all and is recorded as a known `false`
  (`recordAppellantGrant`); granting the install puts it back to `NULL` -- including over an earlier `false`,
  because a bounce weeks ago says nothing about whether they have since reopened their DMs. A `failed` send is
  deliberately **not** written: a timeout is a fact about a request, not about an account.
- **One bit of that table is ever mod-facing**, and it is on the card: `dmReachable === false` renders "Heads
  up: ... may never reach them" while pending and "**They were not told.**" once decided. Silent denials are
  exempt at both ends -- nothing was ever going to be sent, and "they were not told" on a card that already
  says "do not contact them about this" is an invitation to go and fix it.
- **Delivery runs before the card is redrawn**, on both surfaces. The card renders `dm_reachable` and the
  delivery is what writes it; the other order leaves a card claiming a decision landed when it bounced, until
  something redraws it -- which for a decided appeal is never.
- **`appeal_events` gained a `DELIVERY` kind**, actor NULL, body carrying the sentence
  (`describeAppealDelivery`). `dm_reachable` is one row per person overwritten by every later attempt, so it
  can answer "can we reach them" and never "was _this_ decision delivered", which is what a moderator looking
  at an old appeal is asking. It renders on the dashboard's trail as the verb rather than as a quote beneath
  one, since the sentence depends on the outcome rather than on the kind.
- **The re-add rotates the token before it spends it.** Discord invalidates a refresh token the moment it is
  redeemed, so an `addMember` that throws with the rotation unsaved leaves the account holding a dead
  credential and every later approval silently falling back to an invite. The refreshed scope is re-checked too
  -- somebody can re-authorize and trim `guilds.join` on the way through, and the row records what they agreed
  to _last_ time.
- **The credential is dropped once no `PENDING` appeal of theirs can spend it** (`dropSpentRejoinCredential`),
  which closes the risk-list item about holding a live grant for weeks. `granted_guilds_join` survives it: that
  is the record of what they agreed to, not the means. `/auth/me` therefore exposes a derived `canRejoin`
  (grant **and** token) rather than the raw flag, so the form never offers a re-add nothing could perform.
- **The invite fallback is single-use and a week long** (`APPEAL_REJOIN_INVITE_MAX_AGE_SECONDS`), minted against
  the rules channel, then the system channel, then up to five text channels. `CREATE_INSTANT_INVITE` is not a
  permission the Appeals setup asks for, so failing to mint one is ordinary -- and when it fails, the outcome is
  downgraded from `invited` to `none` **before** the copy is built, so neither the DM nor the moderator's line
  promises a link nobody has.
- **`appeals_deliveries_total{kind,outcome,source}`** in both registries, split by `kind` because a DM is
  refused by the _appellant's_ privacy settings and a re-add by a permission the _guild_ never granted. The
  alert-worthy series is `kind="dm", outcome="failed"` -- `blocked` is nothing we deploy can fix.
- The dashboard's `auto_rejoin` toggle already existed (P2); its copy now describes all three sides, and the
  appeal detail's sidebar says when an appellant asked to be added back, so Approve's effect is stated before
  it is pressed.

The two Discord halves are twins (`services/api/src/util/appealDelivery.ts`,
`services/appeals-bot/src/lib/appealDelivery.ts`), the same arrangement `syncAppealCard` already has, and for
the same reason: `backend-core` has no `@discordjs/rest` dependency. The one Discord call that carries no bot
token -- the OAuth refresh -- lives in `backend-core` as a plain form POST instead, going direct for the same
reason `discordAPIOAuth` does.

_Verify:_ `build`/`lint`/`test`/`format:check` green, with the DM copy, the card's reachability line, the
delivery sentence and the consent default covered by unit tests. Runtime is the owner's: approve an appeal with
the box ticked and `auto_rejoin` on, and confirm the account is back in the server with no invite in the DM;
approve one with the box unticked and confirm the DM carries a single-use invite instead; deny one and confirm
the reason arrives quoted; deny one silently and confirm **nothing at all** is sent; then revoke the
authorization from Discord's settings and confirm an approval degrades to the invite rather than failing.

### P7 -- Configurable questionnaire

- Dashboard question builder (add/edit/reorder/remove, style, required, max length) and dynamic rendering on `unban.app`.
- Additive by construction: `prompt_snapshot` means existing answers keep rendering against the prompt they were given.

_Verify:_ edit a question after appeals already exist and confirm historical appeals still display their original prompts.

### P8 -- Auto-unappealable via ban-reason matching

- Per-guild patterns evaluated against the ban reason the probe already returns, at submit time and when rendering the guild.
- Dashboard CRUD, plus a preview showing what a given pattern would match.

_Verify:_ a ban whose reason matches is refused at submit with a clear message; a near-miss is not.

### P9 -- Timeout appeals

- OAuth gains the `guilds` scope; discovery is the member-fetch path from §4, not the ban probe.
- `appeals.kind = 'timeout'`; approval clears `communication_disabled_until` rather than unbanning.
- Handle the punishment expiring mid-appeal -- the appeal becomes moot, not approved.

_Verify:_ file a timeout appeal, approve it, confirm the timeout clears; file another and let the timeout lapse naturally,
confirming the appeal resolves as moot rather than sitting pending forever.

## Verification

Per [workflow.md](../workflow.md#verification-standard), every phase needs `turbo run build lint test` green **and** the
affected service run locally against a migrated database and a real test guild, exercising that phase's `_Verify:_` line.
Phase-specific notes on top of that:

- **P0** is the one phase with no runtime surface of its own, and therefore the one most likely to be under-verified. Its
  real test is `apps/website` behaving identically, so click through it rather than trusting the typecheck.
- **P1** needs a genuinely separate Discord application -- creating one is part of the phase, not a prerequisite someone else
  provides.
- **P3** needs two browser profiles to keep the two sessions honestly separate. **P4** needs no tunnel -- its interactions
  come over the gateway, so a locally-run `appeals-bot` answers buttons in a real test guild with no inbound network at all.
- **Silent denials** need explicit verification from the appellant's side, not just the moderator's, in P4 and again in P6.

## Risks and known sharp edges

- **Storing appellants' OAuth refresh tokens** is a new class of secret in this system, held for weeks, belonging to users with
  every reason to be hostile to the guilds involved. Encrypted at rest, never exposed to a guild's moderators, and -- since
  P6 -- deleted the moment no `PENDING` appeal of theirs can still spend one, which is the only state that can. Filing
  another appeal means signing in again, which re-records it before the form renders.
- ~~**Poll staleness.**~~ Gone with the poll: the guild list is `GUILD_CREATE`/`GUILD_DELETE`/`READY` off Appeals' own
  gateway, the same path every other bot uses, so a guild that just added the bot is there immediately.
- **Nothing in the product can force the appeal link in front of a banned user _in a guild ChatSift does not moderate_**
  (decision 16, as superseded). For guilds on AutoModerator, P1b closes this: the ban DM is ours and carries the link. For
  every other guild the original risk stands unchanged -- Appeals depends on them pasting a link into their own ban-reason
  template, and the `unban.app/<inviteCode>` form exists precisely because that dependency will often go unmet.
- **Silent denials mean the site knowingly shows a state that is not real.** That is the owner's call and the point of the
  feature, but it should be written down as a tradeoff rather than discovered later -- including that the true status remains
  in the database if a user ever asks for their data.
- **Leaking a silent denial is a one-line mistake with no default test coverage.** One serializer, tested.
- **Two sessions, two applications.** The `kind` discriminator and distinct cookie names are what stop a confused-deputy
  problem here; neither is optional.
- **A decision is a claim, then a Discord call, then an audit row, in that order.** `applyAppealDecision` owns the
  ordering and the rollback; anything that decides an appeal without going through it can leave the appellant unbanned
  against a row that says denied, or approved against a ban that is still in place.
- **That ordering covers a failed unban, not a dead process**, and the gap is deliberate. If `appeals-bot` is killed in the
  window between the claim committing and the unban returning, the appeal reads `APPROVED` with the ban still in place and
  nothing retries it. Closing that properly means a transactional outbox -- commit the decision, the event and a
  pending-effect row together, then drive Discord from a worker with retries -- which is a second durability mechanism this
  stack has nowhere else. Raised by review on #410 and **declined**: `services/automoderator-bot`'s report actions have
  carried the identical window since P3, the exposure is a few hundred milliseconds per decision, and the failure is visible
  (the appellant is still banned) rather than silent. Revisit if Appeals ever grows an automated decider, where nobody is
  watching.
- **P6 must not deliver its DM through `perform`.** That callback's contract is that throwing un-does the decision, which is
  right for an unban and wrong for a notification: an appellant with DMs closed would un-deny their own appeal by being
  unreachable. The DM belongs after the transition returns, best-effort, the way `notifyTarget()` already works in
  AutoModerator.
- **`unban.app` is a public form for hostile users by construction.** Rate limits, cooldowns, and `max_appeals` are the
  product's spam defense, and ban evasion via alt accounts is not solvable here -- Appeals sees only the account in front of
  it.
- **`apps/appeals` needs its own Vercel project and domain.** The root `Dockerfile` never copies `apps/` at all, and
  `docker-compose.yml` covers only the six services; `apps/website` already deploys out-of-band on Vercel and this will too.
  What _has_ changed since this was written: TLS and routing for `unban.app` are now an in-repo change to
  `build/caddy/Caddyfile` (#305 absorbed Caddy from its own repo), separately gated in `.github/workflows/ci.yml` and built
  as its own `:<channel>-caddy` image. That is a real edit in this repo, not somebody else's infrastructure ticket.

## Open questions (not blocking, revisit during implementation)

1. ~~**Can a user-installed app DM the user who installed it, with no shared guild?**~~ **Resolved, 2026-08-03: yes.** Confirmed
   manually -- a user install's consent screen shows "Send you direct messages" as its own line next to "Create commands", and
   a DM was actually delivered with no shared guild. §6 and decision 10 rely on this entirely; the notification guild is
   dropped rather than kept as a fallback.
2. **A silent denial that reads as "under review" forever also blocks re-appealing**, since an open appeal normally prevents
   a new submission -- which makes silent denial permanent in practice, not merely quiet. Recommendation: once the cooldown
   lapses, the public view flips to a neutral "no response -- you may appeal again" and a resubmission is allowed, with the
   prior silent denial plainly visible to moderators. Owner's call, and **live as of P4** -- a silent denial can be taken
   today, so this is now a question about behaviour in production rather than about an unbuilt path.
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
- **A "which servers am I banned in?" list**, in any form -- best-effort included. See §4.
- **Sending the ban DM ourselves** (decision 16), and by extension any promise that appellants will actually receive a link.
- **Folding Appeals into ModMail** (decision 15).
