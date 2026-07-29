-- Enables per-query performance stats (#270), backing the `postgres-exporter` service's
-- `stat_statements` collector. Requires `shared_preload_libraries=pg_stat_statements` (set via
-- the `postgres` service's `command:` in docker-compose.yml) - the extension is inert without it.
--
-- docker-entrypoint-initdb.d scripts only run against a FRESH data directory. On an
-- already-provisioned volume (existing dev/prod), this file won't fire automatically - run the
-- manual one-time step in docs/workflow.md instead.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
