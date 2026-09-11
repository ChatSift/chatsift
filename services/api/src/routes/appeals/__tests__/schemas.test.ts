import { expect, test } from 'vitest';
import { appealStatusSchema, decideAppealBodySchema } from '../schemas.js';

/**
 * The two rules on a dashboard decision that are not visible from the shape of the object (#232 P5). Both
 * exist to keep the dashboard and the card in Discord offering the *same* act, which is decision 1.
 */

function rejects(body: Record<string, unknown>, path: string) {
	const result = decideAppealBodySchema.safeParse(body);
	expect(result.success).toBe(false);

	// Narrowed rather than optional-chained, so a parse that starts succeeding fails here rather than quietly
	// asserting `undefined === undefined`.
	if (result.success) {
		expect.fail('expected the parse to fail');
	}

	expect(result.error.issues.some((issue) => issue.path[0] === path)).toBe(true);
}

test('an ordinary denial has to say why', () => {
	rejects({ decision: 'deny' }, 'reason');
	rejects({ decision: 'deny', reason: null }, 'reason');
	// Whitespace is trimmed before the check, so a spacebar is not a reason.
	rejects({ decision: 'deny', reason: '   ' }, 'reason');

	expect(decideAppealBodySchema.safeParse({ decision: 'deny', reason: 'ban evasion' }).success).toBe(true);
});

test('a silent denial may say nothing at all', () => {
	// Nobody is waiting on it, so an empty box is a legitimate "no comment" -- the same rule the card's modal
	// enforces with `required: !silent`.
	expect(decideAppealBodySchema.safeParse({ decision: 'deny_silent' }).success).toBe(true);
	expect(decideAppealBodySchema.safeParse({ decision: 'deny_silent', reason: null }).success).toBe(true);
	expect(decideAppealBodySchema.safeParse({ decision: 'deny_silent', reason: 'evading' }).success).toBe(true);
});

test('an approval carries no reason', () => {
	// Refused rather than ignored: P6 DMs a non-silent decision's reason, and the card has no reason box on
	// Approve at all, so accepting one here would put text in front of an appellant that only one of the two
	// surfaces could ever produce.
	rejects({ decision: 'approve', reason: 'welcome back' }, 'reason');

	expect(decideAppealBodySchema.safeParse({ decision: 'approve' }).success).toBe(true);
	expect(decideAppealBodySchema.safeParse({ decision: 'approve', reason: null }).success).toBe(true);
});

test('the queue filter offers exactly the statuses a row can hold, in display order', () => {
	// Hand-mirroring `appeal_status` is the failure mode this guards: a status the database can write and the
	// filter cannot name is an appeal nobody can find. Asserted in order, not as a set, because the dashboard
	// lists the filter in exactly this order (`APPEAL_STATUSES`) and open work belongs at the top.
	expect(appealStatusSchema.options).toEqual(['PENDING', 'APPROVED', 'DENIED', 'WITHDRAWN', 'MOOT']);
});
