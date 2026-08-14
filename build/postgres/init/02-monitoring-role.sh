#!/bin/bash
set -euo pipefail

# Dedicated role for `postgres-exporter`, so its own scrape traffic can be told apart from the
# application's. Both filters below key on the role, and neither is possible while the exporter shares
# `chatsift` with every service:
#
#   1. `--collector.stat_statements.exclude_users` (docker-compose.yml) drops this role's queries from the
#      exported metrics, so the Grafana top-slowest table stops being dominated by the exporter's own
#      `pg_stat_user_tables`/`pg_settings` reads rather than by anything we wrote.
#   2. `log_min_duration_statement = -1` below exempts this role from the slow-query log entirely. That one
#      has no exporter-side equivalent -- the log is written by Postgres itself, so a per-role override is
#      the only lever. Without it, a scrape every 15s writes a slow-query line forever at any threshold low
#      enough to be interesting.
#
# `pg_monitor` is required, not decorative: without it a non-superuser sees other roles' query text as
# `<insufficient privilege>` in `pg_stat_statements`, so the dashboard would go blank rather than filtered.
#
# A shell script rather than a `.sql` file (unlike 01-pg-stat-statements.sql) purely so the password can come
# from the environment -- `psql -f` does no env substitution. The password ships in .env.public alongside the
# application's own, since this role is strictly weaker than that one and postgres is never externally reachable.
#
# docker-entrypoint-initdb.d scripts only run against a FRESH data directory. On an already-provisioned
# volume (existing dev/prod), this won't fire automatically - run the manual one-time step in
# docs/workflow.md instead.

# Fails the init rather than skipping: a silently absent role means the exporter cannot connect at all, and the
# symptom is a blank Grafana dashboard days later rather than a container that refuses to start now.
if [ -z "${POSTGRES_EXPORTER_PASSWORD:-}" ]; then
  echo "POSTGRES_EXPORTER_PASSWORD is unset -- it ships with a default in .env.public, so this means it was" >&2
  echo "deliberately blanked. Refusing to create a passwordless monitoring role." >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=password="$POSTGRES_EXPORTER_PASSWORD" <<-'EOSQL'
	DO $$
	BEGIN
	  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'chatsift_exporter') THEN
	    CREATE ROLE chatsift_exporter LOGIN;
	  END IF;
	END
	$$;

	ALTER ROLE chatsift_exporter WITH PASSWORD :'password';
	GRANT pg_monitor TO chatsift_exporter;
	-- `pg_monitor` alone is NOT enough. It grants the stats *privilege*, but `pg_stat_statements` is a view
	-- living in whichever schema the extension was created in (`public` here), and this database's `public`
	-- has no USAGE for PUBLIC -- so the read fails with "permission denied for schema public" before any
	-- monitoring privilege is consulted. Verified against a real instance; without this line the exporter's
	-- stat_statements collector silently produces nothing.
	GRANT USAGE ON SCHEMA public TO chatsift_exporter;
	ALTER ROLE chatsift_exporter SET log_min_duration_statement = -1;
EOSQL
