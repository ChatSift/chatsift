# Workflow

Conventions for working on the ChatSift rebirth (see [roadmap/00-overview.md](roadmap/00-overview.md) for product context).

## Branching & PRs

- Work happens on feature branches off `main`, one PR per logical change. Suggested branch naming: `<type>/<short-description>` (e.g. `feat/ama-guest-queue`, `refactor/defineRoute-ama-routes`, `docs/roadmap-scaffolding`).
- Squash-merge to `main` with a conventional-commit-style message (see below) — keeps `main`'s history one-commit-per-change even if a branch had many WIP commits.
- Reference the relevant milestone/issue in the PR description (`Closes #123`).
- Global merge gate: `turbo run build lint test format:check` green. Anything with a runtime surface (anything other than docs/tests) also needs a manual pass exercising the change — but see [Verification standard](#verification-standard) for which half of that an agent can actually do and which half is yours.

## Commit messages

This repo uses **commitlint** (`@commitlint/config-angular`) enforced by a `commit-msg` husky hook (`.husky/commit-msg`, `.commitlintrc.json`). Allowed types:

```
chore, build, ci, docs, feat, fix, perf, refactor, revert, style, test, types
```

Format: `<type>(<optional scope>): <subject>`. Scope case isn't enforced; exclamation-mark breaking-change markers aren't enforced either (both disabled in `.commitlintrc.json`). Example: `feat(ama-bot): add guest-review queue handlers`.

## Local environment

`docker-compose.yml` provides `postgres`, `redis`, `dozzle` (log viewer), plus containerized `api`, `ama-bot`, and `modmail-bot` services (and one commented-out `modmail-bot-<partner-slug>` template per custom instance, see below) built from the root `Dockerfile`. For day-to-day development, run `postgres` + `redis` via compose (`docker compose up -d postgres redis`) and the Node services directly via the root `yarn dev:api` / `yarn dev:ama-bot` / `yarn dev:modmail-bot` scripts — each builds the service (and its workspace deps) with turbo, then runs the built `dist/bin.js` with `.env.private`/`.env.public` auto-loaded via `dotenv-cli`. Re-run the script after making changes; there's no watch mode. This is faster than rebuilding containers each time.

Vars that differ between a host-run service and a containerized one (`REDIS_URL_DEV`/`REDIS_URL_PROD`, `API_URL_DEV`/`API_URL_PROD`, `FRONTEND_URL_DEV`/`FRONTEND_URL_PROD`) are all declared in `.env.public` and resolved via `IS_PRODUCTION` (from `.env.private`) in `packages/private/backend-core` — `IS_PRODUCTION=false` locally, so these already point at `127.0.0.1`/`localhost` without any manual overriding.

Environment variables are split `.env.public` (checked in, non-secret defaults) / `.env.private` (gitignored, secrets) — see `.env.private.example` for the required shape.

### Database

Prisma/Kysely are gone as of M1 (#132). The root `db:*` scripts (`dotenv -e .env.private -e .env.public -- yarn workspace @chatsift/db run ...`) wrap `packages/db`'s Atlas/kanel scripts:

- `db:migrate` → `atlas migrate apply`
- `db:migrate:down` → `atlas migrate down`
- `db:gen` → kanel codegen (writes `packages/db/src/generated/`, committed)
- `db:diff` → `atlas migrate diff` (generates a migration from a schema change)

`getContext().db` is now the `postgres.js` raw SQL client (`@chatsift/db`) everywhere — no more `rawDb`/legacy-`db` split.

**kanel gotchas**, if you ever touch `packages/db`'s codegen setup:

- Config file must be `kanel.config.cjs`, not `.js`. kanel's CLI loads it via a bare `require(...)`; under this package's `"type": "module"`, requiring a `.js` file returns the unwrapped ESM-interop `{ default: {...} }` shape instead of the config object, so every option (including `connection`) silently vanishes and kanel falls back to a bare default `pg` connection.
- `getPropertyMetadata` must camelCase row property names (via `@kristiandupont/recase`, `recase('snake', 'camel')`) — kanel only PascalCases type/interface names by default, not properties, so without this override generated types carry snake_case keys while actual query results are camelCase at runtime (per the `postgres.camel` transform above).
- `@electric-sql/pglite` must stay a devDependency even though nothing uses the pglite driver — kanel's CLI crashes on startup without it, due to an unconditional unmet peer `require` inside `extract-pg-schema`'s nested `knex-pglite` dependency.

### Query performance tracking (#270)

Entirely DB-side, zero-dependency (reuses infra already in the stack — Prometheus/Grafana/dozzle — no new npm
packages, no application code). An app-level equivalent (timing queries in `createDb()`) was considered and
deliberately rejected: postgres.js exposes no query-completion event, so the only way to time an individual
`` sql`...` `` call is `Proxy`-wrapping the client or rewriting every call site — not worth it when this DB-side
layer already gives the same signal (which query, how slow) for free.

The `postgres` compose service enables `pg_stat_statements` (`shared_preload_libraries`,
`log_min_duration_statement=${POSTGRES_SLOW_QUERY_LOG_MS:-200}` — slow queries land in dozzle like every other
service's logs) and mounts `build/postgres/init/01-pg-stat-statements.sql`
(`CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`). `log_parameter_max_length=0` is also set, so a slow
statement's logged text stays `$1`/`$2` placeholders — bound values (Discord IDs, ticket/message content, etc.)
never reach the log. A `postgres-exporter` service scrapes it into the existing Prometheus
(`build/prometheus/prometheus.yml`), and the `postgres-overview` Grafana dashboard
(`build/grafana/dashboards/postgres-overview.json`) surfaces connections, cache hit ratio, throughput, locks, and a
top-20-slowest-queries table (from the exporter's native `--collector.stat_statements`, not the deprecated
`queries.yaml`/`--extend.query-path` mechanism — this one is cardinality-bounded by `queryid`, and never stores
bound values either, by design). Two alert rules (`postgres-down`, `postgres-connections-near-limit`) were added to
`build/grafana/provisioning/alerting/rules.yml`, routed through the existing Discord alert webhook automatically.

**One-time manual step for already-provisioned databases** (both local dev and prod — `docker-entrypoint-initdb.d`
scripts only run against a _fresh_ data directory, so the init script above won't fire on an existing
`chatsift-v3-postgres-data` volume):

```sh
./compose exec postgres psql -U chatsift -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
./compose up -d --force-recreate postgres
```

The restart is required because `shared_preload_libraries` is a postmaster-context setting, not reloadable. Run
this yourself on each already-running Postgres (local + prod) — it's not something an agent should run on your
behalf.

#### The exporter's own monitoring role

`postgres-exporter` connects as `chatsift_exporter`, not as `chatsift`. That separation is what makes its scrape
traffic filterable, and it buys two things that are impossible while it shares the application's role:

- **Out of the Grafana top-slowest table** — `--collector.stat_statements.exclude_users=chatsift_exporter` in
  `docker-compose.yml`. Its `pg_stat_user_tables`/`pg_settings` reads run every 15s and otherwise sit at the top
  of a table whose entire purpose is surfacing queries we wrote.
- **Out of the slow-query log** — `ALTER ROLE chatsift_exporter SET log_min_duration_statement = -1`. There is no
  exporter-side equivalent for this one: the log is written by Postgres, so a per-role override is the only
  lever. It is also what makes lowering `POSTGRES_SLOW_QUERY_LOG_MS` worth doing — without it, any threshold low
  enough to catch a query drifting from 3ms to 80ms also logs the exporter forever.

`build/postgres/init/02-monitoring-role.sh` creates it on a fresh volume. **Same one-time manual step as above on
an already-provisioned database** — the password comes from `POSTGRES_EXPORTER_PASSWORD` in `.env.public` (it sits
there rather than in `.env.private` because this role is strictly weaker than the `chatsift` owner whose password is
already checked in beside it, and postgres is never externally reachable):

Run the init script itself rather than a hand-copied version of its SQL — the `init` directory is bind-mounted, so
the script is already inside the running container, and it's idempotent (the role is created only if absent, the
rest re-applies harmlessly):

```sh
./compose exec -e POSTGRES_EXPORTER_PASSWORD="$(grep -m1 '^POSTGRES_EXPORTER_PASSWORD=' .env.public | cut -d= -f2-)" \
  postgres bash /docker-entrypoint-initdb.d/02-monitoring-role.sh
./compose up -d --force-recreate postgres-exporter
```

`-e` is needed because a container's environment is fixed when it is created, so a `postgres` container started
before this variable existed will not have it — passing it on the `exec` avoids restarting the database just to
pick up one variable. It is harmless once the container has been recreated for other reasons.

**Do not re-spell this as a series of `psql -c` flags.** `psql` performs no `:'variable'` interpolation in `-c`
strings — the literal `:'password'` reaches the server, `ALTER ROLE … WITH PASSWORD` fails with a syntax error, and
because the other statements still succeed (and psql exits 0 without `ON_ERROR_STOP`) you get a role that exists,
reads as correctly configured, and cannot authenticate. The symptom is `password authentication failed for user
"chatsift_exporter"` in the exporter's logs while `pg_roles` looks entirely healthy.

Both grants are load-bearing. `pg_monitor` is what stops other roles' query text reading as
`<insufficient privilege>`. The `USAGE ON SCHEMA public` is easy to miss and fails differently: `pg_stat_statements`
is a view in whichever schema the extension was created in, and this database's `public` grants PUBLIC no USAGE, so
the read dies with `permission denied for schema public` before any monitoring privilege is consulted — the
collector then produces nothing at all. Existing rows in
`pg_stat_statements` are still attributed to `chatsift`, so the old exporter entries linger until the view is
reset (`SELECT pg_stat_statements_reset();`) or Postgres restarts — the filter only applies going forward.

### API request metrics (#277)

Reuses the same Prometheus/Grafana infra as #270, plus one new npm dependency: `prom-client` in `services/api`. The
API's existing per-route timing middleware (`mountRoute` in `services/api/src/core/server.ts` — already fires for
every route, since it's the first middleware `mountRoute` installs) now also observes an
`http_request_duration_seconds` histogram (`services/api/src/core/metrics.ts`), labelled by `method`, `route` (the
route _pattern_, e.g. `/v3/guilds/:guildId` — not the resolved URL, so cardinality stays bounded), and
`status_code`. Request counts and rates are derived from the same histogram (`_count`/`rate(...)`), no separate
counter needed.

The API exposes this at `GET /metrics` (bare, unversioned — matches the same bare `/metrics` every other scrape
target in `build/prometheus/prometheus.yml` already uses), guarded by a Bearer-token middleware
(`services/api/src/middleware/requireMetricsSecret.ts`, mirroring the Dozzle webhook's `requireWebhookSecret`
shared-secret pattern) rather than a custom header — Prometheus's `scrape_config` has native
`authorization.credentials_file` support, which re-reads the token from disk on every scrape, so rotating the
secret needs no Prometheus restart.

A new `api` job in `build/prometheus/prometheus.yml` scrapes `api:7004` with that credentials file. A new
`api-overview` Grafana dashboard (`build/grafana/dashboards/api-overview.json`) shows request rate by route,
p50/p95/p99 latency, and a per-route summary table.

**Every rate/increase on that dashboard is computed over a `$window` template variable (default `1h`), not
`$__rate_interval`.** This API's traffic is low enough — fractions of a request per second — that a ~5m window
contains zero requests for most individual routes, and the latency queries are ratios: `rate(_sum) / rate(_count)`
becomes `0 / 0` = NaN, and `histogram_quantile` over all-zero buckets is NaN too. Those NaNs then rendered on the
table's _base_ threshold colour (green), so "no data" was indistinguishable from "excellent latency". The summary
table's latency queries now additionally guard on `... > 0` (a `> 0` filter on the denominator, and an
`and on (method, route)` guard for the quantile) so a route with no in-window traffic drops out of the result
entirely and displays as an em dash via a NaN/null value mapping. The table also leads with a raw **Requests**
column — at this volume, a p95 is only worth reading next to the sample count it was computed from. Widen `$window`
to 6h/24h when routes still show an em dash; narrow it to chase a short-lived spike.

**One-time manual step** (same shape as Dozzle's `users.yml` setup in #212 — this is the one thing that can't be
committed to git, since `prometheus.yml` has no env-var-expansion mechanism at all):

```sh
# Same value as METRICS_SECRET in .env.private
echo -n '<your METRICS_SECRET value>' > build/prometheus/metrics_secret
chmod 644 build/prometheus/metrics_secret
./compose up -d --force-recreate prometheus
```

Also as part of #277: the `postgres-overview` dashboard's "Top 20 Queries by Mean Execution Time" table dropped the
`datname`, `queryid`, and `user` columns (noise — `queryid` is redundant once `query` text is joined in, and this
deployment is single-database/single-user) via the same `fieldConfig.overrides`/`custom.hidden` mechanism already
used to hide `job`/`instance`.

## Deploying

Two deployments run on the one VPS, from one codebase:

| Channel | Branch   | Checkout                     | `COMPOSE_PROJECT_NAME` | `RESOURCE_PREFIX` | Monitoring | Host API port |
| ------- | -------- | ---------------------------- | ---------------------- | ----------------- | ---------- | ------------- |
| prod    | `main`   | `/home/deploys/repos/prod`   | `chatsift-prod`        | `chatsift-v3`     | yes        | 7004          |
| canary  | `canary` | `/home/deploys/repos/canary` | `chatsift-canary`      | `chatsift-canary` | no         | 7104          |

`RESOURCE_PREFIX` still reads `chatsift-v3` on prod, and the volumes are still named `chatsift-v3-*`, even though
nothing else is called that any more. That is not leftover cruft — see the note below the table.

**Both branches ship a byte-identical `docker-compose.yml` and `.env.public`.** Everything that differs between the
two deployments lives in the host-local, gitignored `.env.private` (see `.env.private.example`). That is deliberate:
the retired `prod` branch carried its own trimmed `docker-compose.yml`, which is why it had to be labelled "do not
merge into `main`" and why it eventually drifted in code as well as config. With zero tracked divergence,
promoting `canary` → `main` is an ordinary merge.

Note `COMPOSE_PROJECT_NAME` and `RESOURCE_PREFIX` differ on prod, and must not be collapsed into one value — see
[Encryption at rest](#encryption-at-rest-263) and the comment above `volumes:` in `docker-compose.yml`.

### The pipeline

`.github/workflows/ci.yml`, on a push to `main` or `canary`:

1. **quality** — `yarn build`/`lint`/`format:check`/`test`.
2. **build-push** — builds the root `Dockerfile` once and pushes `ghcr.io/chatsift/chatsift:<channel>-<sha>`, then
   `turbo run tag-docker --filter '...[HEAD~1...HEAD~0]'` aliases it to the moving `<channel>-<service>` tags that
   compose tracks — only for services whose own code or workspace dependencies changed. Unchanged bots keep their
   old digest and are therefore not restarted by step 3.
3. **deploy** — SSHes to the box and runs the deploy script below.

Two things about the aliasing in step 2 are worth knowing before you trust it:

- The filter selects **packages**, so a change confined to a root file that feeds every image (`Dockerfile`,
  `yarn.lock`, `.yarnrc.yml`, root `package.json`, the shared tsconfigs, `tsup.config.ts`, `turbo.json`) would
  otherwise select nothing, push an image, and never point an alias at it. The workflow detects that case and
  re-aliases every service. `docker-compose.yml` is deliberately excluded — it is read from the checkout at deploy
  time, not baked into the image, so a compose-only change needs no new image at all.
- **`workflow_dispatch` rebuilds and re-aliases everything** on whichever branch you dispatch from. That is the
  escape hatch when the detection above is wrong, or when you want every service on one known digest. It replaces
  the old `deploy-manual.yml`.

The GHCR package is **private**. CI authenticates with the built-in `GITHUB_TOKEN`; the VPS needs a separate
read-only credential (`read:packages` and nothing else), applied once as the `deploys` user:

```sh
printf '%s' '<token>' | docker login ghcr.io -u '<machine-account>' --password-stdin
```

A silently-expired token turns every subsequent deploy into a pull failure, so prefer one that does not expire.

### Rolling back

Every build leaves an immutable `<channel>-<sha>` tag. To roll a single service back, re-point its moving alias and
re-run the deploy:

```sh
docker buildx imagetools create -t ghcr.io/chatsift/chatsift:main-ama \
  ghcr.io/chatsift/chatsift:main-<known-good-sha>
```

### `/home/deploys/bin/deploy` (host-side, not in this repo)

It lives on the host rather than in the checkout on purpose: it must be able to deploy a commit older than any
change to itself, and it must keep working when a bad commit is what you are backing out of.

```bash
#!/bin/bash
set -euo pipefail

# The SSH key is registered with a forced command, so $SSH_ORIGINAL_COMMAND is the only thing the
# caller controls. Validate it against a literal allowlist rather than interpolating it into a path.
case "${SSH_ORIGINAL_COMMAND:-}" in
  main)   BRANCH=main;   REPO=/home/deploys/repos/prod ;;
  canary) BRANCH=canary; REPO=/home/deploys/repos/canary ;;
  *) echo "refusing to deploy unknown channel: ${SSH_ORIGINAL_COMMAND:-<empty>}" >&2; exit 1 ;;
esac

# Lock in the deploys home rather than /var/lock -- that directory's ownership and mode vary by
# distro, and this runs unprivileged.
exec 9>"/home/deploys/.deploy-${BRANCH}.lock"
flock -n 9 || { echo "a ${BRANCH} deploy is already running" >&2; exit 1; }

cd "$REPO"
OLD="$(git rev-parse HEAD)"
git fetch --prune origin "$BRANCH"
git reset --hard "origin/${BRANCH}"
NEW="$(git rev-parse HEAD)"

# Migrations are deliberately NOT run here: atlas is not in the image, and applying one needs the
# host-side IS_PRODUCTION=false + LOCAL_DATABASE_PORT dance below. A deploy that silently skipped a
# required migration would be far worse than one that refuses to continue.
if ! git diff --quiet "$OLD" "$NEW" -- packages/private/db/migrations/
then
  echo "migrations changed between ${OLD:0:8} and ${NEW:0:8} -- apply them, then re-run this deploy" >&2
  exit 1
fi

./compose pull
./compose up -d
docker image prune -f
```

Register the key so it can run nothing else:

```
command="/home/deploys/bin/deploy",no-pty,no-agent-forwarding,no-port-forwarding,no-X11-forwarding ssh-ed25519 AAAA…
```

CI needs `DEPLOY_SSH_KEY`, `DEPLOY_HOST` and `DEPLOY_KNOWN_HOSTS` as repository secrets. The host key is pinned;
do not reach for `StrictHostKeyChecking=no`.

### Applying a migration

Still manual, and still from the host shell rather than a container — atlas is a dev dependency, not part of the
image:

```sh
cd /home/deploys/repos/prod
IS_PRODUCTION=false yarn db:migrate
```

`IS_PRODUCTION=false` is required and is not a mistake: with it `true`, atlas resolves `DATABASE_URL_PROD`, whose
`postgres` hostname only exists inside the compose network. Both URLs reach the same database; the `_DEV` one just
goes via the host-published `LOCAL_DATABASE_PORT`. Confirm that port with `./compose port postgres 5432` rather
than trusting `.env.private`, and confirm it is the database you think it is before running anything with
`--live`.

### Renaming a compose project

If `COMPOSE_PROJECT_NAME` ever changes for an existing deployment, run `./compose down` **before** pulling the
change. Otherwise compose loses track of the running containers and the next `up -d` starts a second full set —
including a second Postgres against the same volume.

## Custom ModMail instances (#216)

Branded, single-guild ModMail deployments for approved close partners — see
[roadmap/01-architecture.md §8](roadmap/01-architecture.md#8-custom-modmail-instances-216) for the full design. Hand-managed
by design: there is no dashboard/API provisioning flow, since a `modmail_instances` row
holds a live bot token. The steps below are things only an operator with direct Postgres/compose access runs —
not something an agent should do on your behalf.

### Onboarding a partner

Order matters — do these in sequence, not in parallel:

1. **Insert the registry row first**, before starting anything. `modmail_instances.token` must be the partner's bot
   token encrypted with `ENCRYPTION_KEY`, in the exact AES-256-GCM `base64([iv | ciphertext | authTag])` shape
   `packages/private/backend-core`'s `encrypt`/`decrypt` (`lib/crypt.ts`) use — those functions themselves read
   `ENCRYPTION_KEY` off a fully-initialized app context (`getContext()`), so they aren't a bare one-liner import;
   the snippet below reimplements the same shape standalone instead (verified round-trips correctly against the
   real `decrypt()` during P6's own smoke test):

   ```sh
   npx dotenv -e .env.private -e .env.public -- node -e "
     const crypto = require('crypto');
     const IV_LENGTH = 12;
     const key = Buffer.from(process.env.ENCRYPTION_KEY, 'base64');
     const iv = crypto.randomBytes(IV_LENGTH);
     const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
     const ciphertext = Buffer.concat([cipher.update(process.argv[1], 'utf8'), cipher.final()]);
     console.log(Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString('base64'));
   " '<the partner bot token>'
   ```

   Then insert the row with the encrypted value (pick a stable, lowercase `id` slug — this is what the deployment's
   `MODMAIL_INSTANCE_ID` must match, and renaming it later means redeploying). psql's `:'var'` substitution doesn't
   interpolate through `-c` reliably in every setup — writing the insert to a small `.sql` file and running it with
   `-v`/`-f` is the more reliable route:

   ```sh
   printf "INSERT INTO modmail_instances (id, guild_id, token, label) VALUES ('<partner-slug>', '<guild id>', :'enc', '<display label>');\n" > /tmp/insert_instance.sql
   ./compose exec -T postgres psql -U chatsift -d chatsift -v enc='<encrypted token from above>' -f - < /tmp/insert_instance.sql
   ```

   (`-T` disables the pseudo-tty compose would otherwise allocate, which is what lets the `<` redirect actually
   reach `psql`'s stdin through `docker compose exec`.)

2. **Wait up to 60s** (the registry's refresh interval, `packages/private/backend-core/src/lib/instances.ts`) —
   the public `modmail-bot`/`api` processes pick up the new row and stop acting on that guild without a restart.
   Confirm before moving on: the public bot should now answer that guild's leftover commands/panel with "this
   server is served by `<label>`" instead of doing anything.
3. **Start the partner's deployment.** Copy the commented-out `modmail-bot-<partner-slug>` template block in
   `docker-compose.yml` (right after the public `modmail-bot` service), fill in `<partner-slug>` throughout
   (service name, `MODMAIL_INSTANCE_ID`, log volume), uncomment it, then `./compose up -d modmail-bot-<partner-slug>`.
   It fails fast on boot if `MODMAIL_INSTANCE_ID` doesn't match a row (see `loadInstances()`'s doc comment).
4. **Run both Resyncs** for that guild in the dashboard — the button on the ModMail **Snippets** page
   (`services/api/src/routes/modmail/snippets/resyncSnippets.ts`) and the one on the ModMail **Panels** page
   (`services/api/src/routes/modmail/panels/resyncPanels.ts`); both are visible now that the guild has a custom
   instance. They're two separate buttons since #331 — snippets registers every existing snippet as a guild command
   under the partner's application, panels reposts every panel message. Both are needed here, since both kinds of
   object were created under the public application and Discord scopes commands/message-authorship to the
   application that created them.
5. Verify: `/snippet` commands work and the panel button opens a ticket, both through the partner's bot presence.

#### Onboarding a partner who has legacy ModMail history

The steps above assume a guild with no prior history, which was true of every partner onboarded in 2026-07. A
partner self-hosting legacy `ChatSift/ModMail` (their own copy, their own Postgres) needs their data migrated
first — see the NASCAR pilot in
[roadmap/06-modmail-port.md](roadmap/06-modmail-port.md#the-nascar-pilot) for the full sequence. Three deltas to
the runbook above:

- **Migrate before inserting the registry row**, not after. `migrateLegacyModmail.ts`'s preflight warns when a
  legacy guild already has a `modmail_instances` row — harmless in this case, but it's a warning worth keeping
  meaningful for the public cutover.
- **Pass `--source <partner-slug>`** to the migration, matching the instance slug. This is what keeps one
  partner's migration from blocking or miscounting the public one later.
- **Step 4's Snippets resync is mandatory, not optional** — migrated `snippets.command_id` values belong to the
  partner's _legacy_ application and 404 under their new one. The Panels resync is a no-op for a migrated guild
  (legacy had no panels), but pressing it costs nothing. Their admin must also pick a Forum on the dashboard
  before anything works: `mod_forum_id` is deliberately migrated as `NULL`.

### Offboarding a partner (moving a guild back to the public deployment)

Reverse order — resync while the row (and therefore the partner's token) is still reachable, _then_ tear down:

1. **Run both Resyncs first** (Snippets page, then Panels page), while the `modmail_instances` row still exists.
   Deleting the row before this loses the ability to reach the partner's application at all for cleanup, and —
   more importantly — resync always targets whichever application the registry says currently owns the guild, so
   it must run before the row disappears for a swap in this direction to have anything to reconcile _from_.

   Note this asymmetry with onboarding: resync targets the _new_ owner, and during offboarding the new owner
   (public) only becomes current once the row is gone. So this step actually happens in two parts — run both
   buttons with the row still present to let the partner's application clean up what it can reach, then delete the
   row (step 3 below), then run both again now that the guild resolves to the public application, to
   recreate/repost everything under it. Four button presses total, two per page.

2. **Stop the partner's deployment** (`./compose stop modmail-bot-<partner-slug>`, then remove or re-comment its
   `docker-compose.yml` block).
3. **Delete the registry row** (`DELETE FROM modmail_instances WHERE id = '<partner-slug>'`). The public bot
   resumes ownership within 60s of this.
4. **Run both Resyncs again** for the same guild, now that it resolves to the public deployment, to finish
   reconciling snippets (Snippets page) and panels (Panels page) onto it.
5. Verify the same golden path as onboarding, this time through the public bot.

## Scaling a bot across replicas

Design and rationale: [docs/roadmap/12-horizontal-scaling.md](roadmap/12-horizontal-scaling.md). This is the
operational half.

**Nothing is needed until Discord recommends more than one shard for a bot.** Below that, leaving
`<BOT>_SHARDS_PER_REPLICA` blank is correct — the bot already runs one replica holding every shard, through the
same code path a scaled one uses.

### Turning it on

1. Check what Discord actually recommends. There is no point sharding ahead of it:

   ```bash
   curl -s -H "Authorization: Bot $TOKEN" https://discord.com/api/v10/gateway/bot | grep -o '"shards":[0-9]*'
   ```

2. Set `<BOT>_SHARDS_PER_REPLICA` in `.env.public` (`AMA_`, `MODMAIL_`, `SOCIAL_`). This is the only number to
   choose: how many shards one replica should carry. Replica count is derived from it.
3. `./compose up -d`. It reads `/gateway/bot` itself, prints the arithmetic
   (`ama-bot: 14 shard(s) / 4 per replica -> 4 replica(s)`) and passes `--scale`.
4. Confirm each replica claimed a distinct index:

   ```bash
   ./compose logs ama-bot | grep 'claimed replica slot'
   ```

   Every replica should appear once, with disjoint `shardIds` whose union is the full shard range.

### Changing the number later

Re-run `./compose up -d`. Discord's recommendation is re-read every time, so a shard-count bump is picked up at
the next deploy without anyone editing a number. Between the bump and that deploy the cluster is
under-provisioned, not broken — a replica absorbs the uncovered shards and logs `covering for missing replicas`.

### Turning it off

Blank the value and `./compose up -d`. Compose scales the service back to one; the survivor's watcher notices the
freed indices and restarts once to take them over.

### Things worth knowing

- **Replicas are cattle.** They share one image and one env block; which shards each runs is claimed at boot, not
  configured. Never hand-pin a replica to a shard range.
- **Restarting a replica is cheap and is the intended way to change its shard set** — sessions are stored in redis
  and resumed, so a bounce replays a gap rather than re-identifying.
- **Start replicas together.** A replica joining long after the others idles as a hot spare rather than
  rebalancing (`no free replica index` in the logs). `./compose up` does the right thing; starting one by hand
  later does not.
- **Log files gain a per-container suffix** (`2026-08-13.<container-id>.log`) once a bot is scaled, because all
  replicas bind-mount the same host directory. Unscaled bots keep the plain `<date>.log` name. Dozzle is
  unaffected either way — it reads stdout, which is per-container regardless.
- **Custom ModMail instances (#216) are never scaled.** They are single-guild by definition, so one shard, one
  replica. `./compose` only sizes the public deployments.

## Encryption at rest (#263)

Discord's Developer Terms of Service §5(c) ("Implement Good Security") lists "encryption of the data at rest" as a
required safeguard for API Data. Nearly everything in Postgres (Discord IDs, AMA question content, ModMail
transcripts, snippet content, guild settings — only `modmail_instances.token` is already application-level
encrypted, see the custom-instances section above) sits in plaintext on the host's disk today. Redis needs no
equivalent treatment: nothing in the stack treats it as a source of truth (`GuildList`/instance snapshots
republish on an interval, `PendingTicketStore` mirrors the durable `pending_tickets` table, grant-token claims are
best-effort), so `docker-compose.yml`'s `redis` service instead runs with RDB/AOF disabled
(`--save '' --appendonly no`) — fully in-memory, nothing on disk to encrypt in the first place.

For Postgres, the chosen approach is **native ext4 directory encryption (`fscrypt`)** on the existing disk, not a
separate LUKS-encrypted volume — fewer moving parts (no new block device to provision/attach/bill for, no loop
files, no `crypttab`), and the underlying crypto (AES-256-XTS via the kernel's AES-NI-accelerated path) is the same
either way. Confirmed viable on the production host: `df -T /` reports `ext4`, and `/proc/cpuinfo` has the `aes`
flag (plus `pclmulqdq`) — so this is expected to be a performance non-event (low single-digit percent at most on
sustained write-heavy I/O, no measurable memory or storage overhead; content encryption is block-for-block, no
size inflation).

**This is an operator runbook, not something an agent should do on your behalf** — it needs root on the production
host, a maintenance window, and judgment calls (backup verification, reboot testing) that shouldn't be automated
blind.

> **Status: done, live on the production host as of 2026-08-05.** The steps below are what was actually run,
> corrected in place for two `fscrypt` CLI mistakes discovered live (see the callouts on steps 4 and 6 — `encrypt`
> takes `--key=FILE`, not `--key-file=FILE`, and `unlock` doesn't accept `--source` at all, only `encrypt` does).
> The happy-path reboot test (step 7) was run for real and passed. The failure-path half of step 7 was
> deliberately **not** run against production — this host also runs real, currently-serving workloads unrelated to
> ChatSift, and deliberately breaking the boot sequence to prove a negative wasn't worth that risk once the
> mechanism (`docker.service`'s `Requires=` on the unlock unit) was understood and the happy path confirmed
> working. If this is ever re-run on a different host, the failure-path test is still worth doing there.

1. **Enable the ext4 encryption feature** (online, doesn't require unmounting `/`). Resolve the actual backing
   device rather than assuming `/dev/sda1` — that's `df -T /`'s current output on the production host, but isn't
   guaranteed to stay the device Docker's data lives on (a future attached volume, a differently-partitioned
   replacement host, etc.):
   ```sh
   docker_device="$(findmnt -no SOURCE /var/lib/docker)"
   [ "$(findmnt -no FSTYPE /var/lib/docker)" = ext4 ] || { echo "not ext4, stop here"; exit 1; }
   sudo tune2fs -O encrypt "$docker_device"
   ```
2. **Install and initialize fscrypt** (one-time, `apt install fscrypt` on recent Debian/Ubuntu; build from
   [google/fscrypt](https://github.com/google/fscrypt) if unpackaged):
   ```sh
   sudo apt install fscrypt
   sudo fscrypt setup
   ```
3. **Stop Postgres and set the data directory aside** — `fscrypt encrypt` requires an empty target directory:
   ```sh
   ./compose stop postgres
   sudo mv /var/lib/docker/volumes/chatsift-v3-postgres-data/_data /var/lib/docker/volumes/chatsift-v3-postgres-data/_data.bak
   sudo mkdir /var/lib/docker/volumes/chatsift-v3-postgres-data/_data
   ```
4. **Generate the unlock key and encrypt the directory.** A raw keyfile (not a passphrase protector) is what lets
   this unlock unattended at boot — treat it like `ENCRYPTION_KEY`: back it up offline (e.g. a password manager),
   since losing it makes the encrypted directory permanently unrecoverable, independent of normal DB backups.
   ```sh
   sudo sh -c 'head -c 32 /dev/urandom > /etc/fscrypt-postgres.key && chmod 600 /etc/fscrypt-postgres.key'
   sudo fscrypt encrypt /var/lib/docker/volumes/chatsift-v3-postgres-data/_data \
     --source=raw_key --key=/etc/fscrypt-postgres.key --name=postgres-data
   ```
   The flag is `--key=FILE`, not `--key-file=FILE` (`fscrypt encrypt --help` is the source of truth if this drifts
   again — the CLI doesn't do fuzzy matching, an unrecognized flag just dumps usage and exits 1). `--name` avoids
   an interactive prompt for the protector's name. The directory is unlocked for the current session immediately
   after `encrypt` runs, so it's writable right away.
   Copy `/etc/fscrypt-postgres.key`'s contents off the host now, before going any further — it's the only thing
   standing between an intact backup and permanently unrecoverable data, same as `ENCRYPTION_KEY`. It's raw binary,
   not text, so base64-encode it for safe storage (`base64 -w0 /etc/fscrypt-postgres.key` on Linux, `base64 -b 0
-i` on macOS) into a password manager as a Secure Note, and include the exact restore command
   (`base64 -d > /etc/fscrypt-postgres.key && chmod 600 /etc/fscrypt-postgres.key`) in the note body rather than
   just the key on its own. Clean up every plaintext copy made along the way (scp'd-down files, temp copies used to
   get it off the host) once it's safely stored — a copy sitting in a home directory defeats the same purpose the
   `_data.bak` wipe below protects.
5. **Copy the data back in and verify**, then bring Postgres back up:
   ```sh
   sudo rsync -a --info=progress2 /var/lib/docker/volumes/chatsift-v3-postgres-data/_data.bak/ \
     /var/lib/docker/volumes/chatsift-v3-postgres-data/_data/
   ./compose up -d postgres
   ./compose logs postgres  # confirm a clean start, no corruption/recovery errors
   ```
   Once the API and bots are confirmed healthy against it, **securely wipe `_data.bak`**, not just `rm -rf` it —
   a plain delete leaves the plaintext data recoverable from the underlying disk blocks, which defeats the entire
   point of encrypting `_data` in the first place:
   ```sh
   sudo find /var/lib/docker/volumes/chatsift-v3-postgres-data/_data.bak -type f -exec shred -u {} +
   sudo rm -rf /var/lib/docker/volumes/chatsift-v3-postgres-data/_data.bak
   ```
   (`shred` only guarantees overwrite on a filesystem without copy-on-write/journaling quirks that can leave
   stale copies elsewhere on disk — if this ever runs on anything other than plain ext4, treat the whole disk as
   needing attention, not just this one directory.)
6. **Auto-unlock at boot** — the directory relocks on every reboot until something unlocks it again, and that has
   to happen before Docker starts the `postgres` container. A oneshot systemd unit ahead of `docker.service`
   (there's no separate systemd unit for the compose stack itself — Docker's own `restart: unless-stopped` per
   service is what brings containers back after `docker.service` starts):

   ```ini
   # /etc/systemd/system/fscrypt-unlock-postgres.service
   [Unit]
   Description=Unlock fscrypt-encrypted Postgres data directory
   DefaultDependencies=no
   Before=docker.service
   RequiresMountsFor=/var/lib/docker

   [Service]
   Type=oneshot
   ExecStart=/usr/bin/fscrypt unlock /var/lib/docker/volumes/chatsift-v3-postgres-data/_data --key=/etc/fscrypt-postgres.key --quiet
   RemainAfterExit=yes

   [Install]
   WantedBy=multi-user.target
   ```

   `unlock` doesn't accept `--source` at all (that's an `encrypt`-only flag, for choosing what kind of _new_
   protector to create) — only `--key=FILE` for the raw-key path here, and `--quiet` since this runs with no TTY
   at boot and must never sit waiting on a prompt it can't answer. Confirm `which fscrypt` matches the binary path
   in `ExecStart` before enabling — worth checking per-host, not assumed from this doc.

   `Before=docker.service` alone only orders the two units when both are going to start anyway — it doesn't stop
   Docker from starting if the unlock fails. A drop-in on `docker.service` itself turns that into a hard
   dependency, so a failed unlock actually blocks Docker (and therefore the `postgres` container) from starting
   against a missing/still-locked directory instead of quietly booting into an empty one:

   ```ini
   # /etc/systemd/system/docker.service.d/10-fscrypt-postgres.conf
   [Unit]
   Requires=fscrypt-unlock-postgres.service
   After=fscrypt-unlock-postgres.service
   ```

   ```sh
   sudo systemctl daemon-reload
   sudo systemctl enable fscrypt-unlock-postgres.service
   ```

7. **Test the happy path for real** during a maintenance window — this is the non-negotiable one, since it's what
   every routine reboot going forward actually depends on:

   ```sh
   reboot
   # after it comes back:
   systemctl status fscrypt-unlock-postgres.service
   journalctl -b -u fscrypt-unlock-postgres.service --no-pager
   fscrypt status /var/lib/docker/volumes/chatsift-v3-postgres-data/_data   # Unlocked: Yes
   docker compose ps                                                        # everything back on its own
   ./compose logs postgres --tail 30                                        # clean start, no recovery warnings
   ```

   Before this reboot, it's worth a lower-risk dry run of the unlock command itself, without touching the host's
   boot sequence at all: `./compose stop postgres`, `fscrypt lock <dir>`, `systemctl start
fscrypt-unlock-postgres.service`, confirm it succeeds and `fscrypt status` flips back to `Unlocked: Yes`, then
   `./compose up -d postgres`. Catches a broken `ExecStart` line without needing a reboot to find out.

   **The failure-path half — temporarily moving the keyfile aside, rebooting, and confirming `docker.service`
   correctly refuses to start — is worth doing if the host is otherwise idle, but is a judgment call to skip on a
   host that also carries other live production workloads.** `Requires=`/`After=` is well-understood, standard
   systemd behavior, not something exotic that needs live proof to trust; deliberately breaking a boot sequence to
   confirm a negative isn't worth the risk on a shared box once the happy path is already confirmed. If skipped,
   say so explicitly (don't let it read as "forgotten") and revisit on the next host this runs on. **If this step
   is skipped, immediately move the keyfile back to its real path** if it was relocated as prep — an _unplanned_
   reboot before that happens hits the failure path for real, not as a test.

What this does and doesn't defend against: it protects data if the disk is stolen or a backup/snapshot is exposed
on Hetzner's side (the actual scenario "encryption at rest" targets). It does not protect against a live
compromise of the host itself — the key has to be available for Postgres to restart unattended, so a root-level
attacker on a running box can read the unlocked data either way, same as any at-rest scheme for an
always-on service.

## Verification standard

Before calling any phase/issue done. **The two halves have different owners** — an agent does the first, the
operator does the second. Typecheck and unit tests verify code correctness, not feature correctness, and an agent
cannot close that gap on its own: it has no Discord connection and no browser session.

### What an agent can and must verify

1. `turbo run build lint test format:check` green. (Prefer the allowlisted `yarn build` / `yarn lint` / `yarn test`
   shapes — they avoid extra permission prompts.) All four are per-package turbo tasks, so a repeat run is a cache
   hit; use `--force` if you need to distrust the cache.
2. Anything genuinely checkable without Discord or an authenticated session:
   - Unit tests for pure logic — see `services/modmail-bot/src/lib/__tests__/` for the existing patterns. Vitest
     runs per package (`vitest.shared.ts` + a `vitest.config.ts` per workspace), so watch mode is
     `yarn workspace <name> test:watch` rather than a root-level command.
   - A locally-running API: confirm a new route is actually mounted, i.e. it returns **401 rather than 404**. That's
     the ceiling without a session, and it's still worth doing — it catches a route that was written but never
     registered.
   - SQL/migration scripts, diffed against two throwaway scratch databases (src/dst, offset sequences,
     id-independent diff).
3. Read back the code paths the change touches, including every call site, rather than assuming.

### What only the operator can verify

Everything with a real Discord or authenticated-dashboard surface: slash commands, panel buttons, ticket flows, DM
handling, OAuth, and all dashboard UI behaviour. Frontend work is the sharpest case — a Tailwind class that compiles
to nothing (see [frontend.md](frontend.md#theme-and-colour-tokens)) passes build _and_ lint and still renders wrong.

**Report honestly.** State what you ran and what passed. Do not describe a feature as working, verified, or done
when only the typecheck/test half was possible — say explicitly which parts remain, and list the specific golden
path and edge cases worth clicking through, so the manual pass is a checklist rather than a guess.

### Milestones

For milestones with an explicit acceptance-criteria list (M1's zero-`@ts-expect-error` gate, M4/M5's
migration-reconciliation checks), confirm each item explicitly before closing the milestone.

## Where to look first

New to a piece of this work? Start at [roadmap/00-overview.md](roadmap/00-overview.md), then [roadmap/01-architecture.md](roadmap/01-architecture.md) for the current shape of whatever you're touching (`02`–`04` were removed once M1–M3 shipped; `05`/`06` are the two still-active milestone docs, AMA cutover and ModMail migration respectively). The two ADRs ([0001](adr/0001-api-contract-pattern.md), [0002](adr/0002-db-stack.md)) explain _why_ the two big architectural changes were made, in case a decision looks arguable in the moment — reread the ADR before re-relitigating it.
