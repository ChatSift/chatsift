-- Create enum type "automoderator_report_origin"
CREATE TYPE "automoderator_report_origin" AS ENUM ('GUILD', 'DM');
-- Modify "automoderator_reports" table
ALTER TABLE "automoderator_reports" ADD COLUMN "origin" "automoderator_report_origin" NOT NULL DEFAULT 'GUILD';
