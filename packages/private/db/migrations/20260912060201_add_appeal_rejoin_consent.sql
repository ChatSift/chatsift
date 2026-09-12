-- Add value to enum type: "appeal_event_kind"
ALTER TYPE "appeal_event_kind" ADD VALUE 'DELIVERY';
-- Modify "appeals" table
ALTER TABLE "appeals" ADD COLUMN "rejoin_consent" boolean NOT NULL DEFAULT false;
