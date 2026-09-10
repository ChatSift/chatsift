import type { AppealKind, Appeals, AppealStatus } from '@chatsift/db';
import { expect, test } from 'vitest';
import { appearsOpenToAppellant, isAppealOpen, toPublicAppeal } from '../appealsPublic.js';

// kanel exports the generated enums as types only, so every literal here needs the repo's usual cast -- done
// once through these two helpers rather than at forty call sites.
const status = (value: string): AppealStatus => value as AppealStatus;
const STATUSES = ['PENDING', 'NEEDS_MORE_INFO', 'APPROVED', 'DENIED', 'WITHDRAWN'] as const;

function makeAppeal(overrides: Partial<Appeals> = {}): Appeals {
	return {
		id: 1 as Appeals['id'],
		guildId: '1234567890',
		userId: '9876543210',
		kind: 'BAN' as AppealKind,
		status: status('PENDING'),
		silent: false,
		reasonSnapshot: 'ban evasion',
		modMessageId: '111',
		modThreadId: '222',
		decidedAt: null,
		decidedById: null,
		decisionReason: null,
		createdAt: new Date('2026-09-01T00:00:00.000Z'),
		...overrides,
	};
}

test('a silent denial reads as pending', () => {
	const appeal = makeAppeal({
		status: status('DENIED'),
		silent: true,
		decidedAt: new Date('2026-09-02T00:00:00.000Z'),
		decidedById: '555',
		decisionReason: 'ban evasion, obviously',
	});

	expect(toPublicAppeal(appeal).status).toBe('PENDING');
});

test('an ordinary denial reads as denied', () => {
	const appeal = makeAppeal({
		status: status('DENIED'),
		silent: false,
		decidedAt: new Date('2026-09-02T00:00:00.000Z'),
		decidedById: '555',
		decisionReason: 'not this time',
	});

	expect(toPublicAppeal(appeal).status).toBe('DENIED');
});

test('every other status passes through unchanged', () => {
	for (const value of ['PENDING', 'NEEDS_MORE_INFO', 'APPROVED', 'WITHDRAWN'] as const) {
		const decided = value === 'APPROVED' || value === 'WITHDRAWN';
		const appeal = makeAppeal({
			status: status(value),
			decidedAt: decided ? new Date('2026-09-02T00:00:00.000Z') : null,
			decidedById: value === 'APPROVED' ? '555' : null,
		});

		expect(toPublicAppeal(appeal).status).toBe(value);
	}
});

test('no decision detail is emitted, for any status', () => {
	// The rule is "never", not "not for silent denials" -- a `decidedAt` on an appeal reading pending would give
	// a silent denial away on its own, and a denial reason is written for other moderators.
	const forbidden = ['decidedAt', 'decidedById', 'decisionReason', 'silent', 'modMessageId', 'modThreadId', 'userId'];

	for (const value of STATUSES) {
		for (const silent of [true, false]) {
			const appeal = makeAppeal({
				status: status(value),
				silent: silent && value === 'DENIED',
				decidedAt: new Date('2026-09-02T00:00:00.000Z'),
				decidedById: '555',
				decisionReason: 'internal notes',
			});

			const keys = Object.keys(toPublicAppeal(appeal));
			for (const key of forbidden) {
				expect(keys).not.toContain(key);
			}
		}
	}
});

test('the public shape is exactly the six fields it declares', () => {
	// Pinned rather than merely checked for leaks: a column added to `appeals` must not be able to arrive here
	// by accident, which is why the serializer builds its result field by field rather than spreading the row.
	expect(Object.keys(toPublicAppeal(makeAppeal())).sort((a, b) => a.localeCompare(b))).toStrictEqual([
		'answers',
		'createdAt',
		'guildId',
		'id',
		'kind',
		'status',
	]);
});

test('answers carry the prompt they were given, and default to empty', () => {
	expect(toPublicAppeal(makeAppeal()).answers).toStrictEqual([]);
	expect(
		toPublicAppeal(makeAppeal(), [{ position: 0, promptSnapshot: 'Why were you banned?', answer: 'I was not' }])
			.answers,
	).toStrictEqual([{ position: 0, promptSnapshot: 'Why were you banned?', answer: 'I was not' }]);
});

test('a silent denial is closed to moderators but still open to the appellant', () => {
	// The one case the two predicates disagree on, and the reason the second one exists: refusing a resubmit
	// with "already under review" is what stops the cooldown message announcing the decision.
	const appeal = makeAppeal({
		status: status('DENIED'),
		silent: true,
		decidedAt: new Date('2026-09-02T00:00:00.000Z'),
		decidedById: '555',
	});

	expect(isAppealOpen(appeal)).toBe(false);
	expect(appearsOpenToAppellant(appeal)).toBe(true);
});

test('the two predicates agree on every other status', () => {
	for (const value of ['PENDING', 'NEEDS_MORE_INFO', 'APPROVED', 'WITHDRAWN'] as const) {
		const appeal = makeAppeal({ status: status(value), silent: false });
		expect(appearsOpenToAppellant(appeal)).toBe(isAppealOpen(appeal));
	}

	const openDenial = makeAppeal({
		status: status('DENIED'),
		silent: false,
		decidedAt: new Date('2026-09-02T00:00:00.000Z'),
		decidedById: '555',
	});
	expect(appearsOpenToAppellant(openDenial)).toBe(isAppealOpen(openDenial));
});
