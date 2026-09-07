#!/bin/bash
set -euo pipefail

# Dedicated role + database for the `glitchtip` service (#386), the frontend error reporting instance.
# It is a Django app and Postgres is its only datastore -- with `VALKEY_URL` blank it also backs its task
# queue and cache, which is deliberate (see the service definition in docker-compose.yml). It shares this
# instance rather than running its own so there is one volume to back up and upgrade, but that sharing is
# exactly what makes the two exclusions below necessary:
#
#   1. `log_min_duration_statement = -1` here exempts the role from the slow-query log. `POSTGRES_SLOW_QUERY_LOG_MS`
#      is deliberately set to 5ms so that what is left in the log is queries we wrote; Django's ORM churn would
#      bury every one of them within minutes. Same lever, same reason as 02-monitoring-role.sh.
#   2. `--collector.stat_statements.exclude_users` (docker-compose.yml) drops this role from the exported
#      metrics. `pg_stat_statements` is cluster-wide with a fixed `pg_stat_statements.max=5000`, so Django's
#      many distinct statements would otherwise both crowd out application queries from that budget and
#      dominate the Grafana top-slowest table -- the #270 tooling degrades silently rather than loudly.
#
# The role is NOT a superuser and does not need to be. `citext`, `pg_trgm` and friends are "trusted"
# extensions as of PG13, so a database owner may `CREATE EXTENSION` them without elevation -- which is why
# nothing is pre-created here beyond the database itself.
#
# A shell script rather than a `.sql` file for the same reason as 02: the password comes from the
# environment and `psql -f` does no env substitution.
#
# docker-entrypoint-initdb.d scripts only run against a FRESH data directory. On an already-provisioned
# volume (existing dev/prod), this won't fire automatically - run the manual one-time step in
# docs/workflow.md instead.

# Fails the init rather than skipping, matching 02: a silently absent role means glitchtip cannot connect at
# all, and the symptom is a container crashlooping on a connection error rather than a clear failure here.
if [ -z "${GLITCHTIP_DB_PASSWORD:-}" ]; then
  echo "GLITCHTIP_DB_PASSWORD is unset -- it ships with a default in .env.public, so this means it was" >&2
  echo "deliberately blanked. Refusing to create a passwordless role." >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=password="$GLITCHTIP_DB_PASSWORD" <<-'EOSQL'
	DO $$
	BEGIN
	  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'glitchtip') THEN
	    CREATE ROLE glitchtip LOGIN;
	  END IF;
	END
	$$;

	ALTER ROLE glitchtip WITH PASSWORD :'password';
	ALTER ROLE glitchtip SET log_min_duration_statement = -1;
EOSQL

# `CREATE DATABASE` cannot run inside a `DO` block or any transaction, so it can't join the idempotency
# block above and needs its own guard.
if ! psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'glitchtip'" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" | grep -q 1; then
  createdb --username "$POSTGRES_USER" --owner glitchtip glitchtip
fi
