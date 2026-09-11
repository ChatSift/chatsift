-- Modify "appeals" table
ALTER TABLE "appeals" DROP CONSTRAINT "appeals_decision_check", ADD CONSTRAINT "appeals_decision_check" CHECK (
CASE status
    WHEN 'PENDING'::appeal_status THEN ((decided_at IS NULL) AND (decided_by_id IS NULL) AND (decision_reason IS NULL))
    WHEN 'APPROVED'::appeal_status THEN ((decided_at IS NOT NULL) AND (decided_by_id IS NOT NULL))
    WHEN 'DENIED'::appeal_status THEN ((decided_at IS NOT NULL) AND (decided_by_id IS NOT NULL))
    WHEN 'WITHDRAWN'::appeal_status THEN ((decided_at IS NOT NULL) AND (decided_by_id IS NULL))
    WHEN 'MOOT'::appeal_status THEN ((decided_at IS NOT NULL) AND (decided_by_id IS NULL))
    ELSE false
END);
