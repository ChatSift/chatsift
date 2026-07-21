-- Modify "dashboard_grants" table
ALTER TABLE "dashboard_grants" ADD COLUMN "created_at" timestamptz NOT NULL DEFAULT now();
