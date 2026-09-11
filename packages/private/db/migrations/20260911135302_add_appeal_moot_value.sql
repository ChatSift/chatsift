-- Split from the constraint change that uses it, deliberately: postgres refuses to reference a freshly added
-- enum value from the same transaction ("unsafe use of new value \"MOOT\" of enum type", 55P04), and Atlas runs
-- one transaction per migration file. The `appeals_decision_check` arm for 'MOOT' is in the next file, which
-- runs after this one has committed.

-- Add value to enum type: "appeal_status"
ALTER TYPE "appeal_status" ADD VALUE 'MOOT';
-- Add value to enum type: "appeal_event_kind"
ALTER TYPE "appeal_event_kind" ADD VALUE 'MOOT' AFTER 'WITHDRAWN';
