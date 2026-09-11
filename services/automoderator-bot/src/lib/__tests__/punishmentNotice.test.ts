import { beforeEach, expect, test, vi } from 'vitest';

let rows: { content: string; scope: string }[] = [];
let lastValues: unknown[] = [];
let queryError: Error | null = null;

vi.mock('@chatsift/backend-core', () => ({
	getContext: () => ({
		async db(_strings: TemplateStringsArray, ...values: unknown[]) {
			lastValues = values;
			if (queryError) {
				throw queryError;
			}

			return rows;
		},
	}),
}));

const { CASE_ACTION } = await import('../caseActions.js');
const { appendPunishmentNotice } = await import('../punishmentNotice.js');

const logger = { warn: vi.fn() } as never;

const BODY = 'You have been banned in **Guild**.';

beforeEach(() => {
	rows = [];
	lastValues = [];
	queryError = null;
});

test('a guild with no notices gets the DM it would have got anyway', async () => {
	expect(await appendPunishmentNotice(BODY, '1', CASE_ACTION.BAN, logger)).toBe(BODY);
	// Both candidates in one query, keyed on the guild and the action.
	expect(lastValues).toStrictEqual(['1', 'BAN']);
});

test('the general notice is appended when the action has none of its own', async () => {
	rows = [{ scope: 'DEFAULT', content: 'Read the rules.' }];

	expect(await appendPunishmentNotice(BODY, '1', CASE_ACTION.BAN, logger)).toBe(`${BODY}\nRead the rules.`);
});

// The half that is a decision rather than a detail: the two are alternatives, so a guild putting appeal
// instructions on BAN does not also have to restate its general notice inside them.
test("an action's own notice replaces the general one rather than stacking with it", async () => {
	rows = [
		{ scope: 'DEFAULT', content: 'Read the rules.' },
		{ scope: 'BAN', content: 'Appeal at unban.app/g/1.' },
	];

	expect(await appendPunishmentNotice(BODY, '1', CASE_ACTION.BAN, logger)).toBe(`${BODY}\nAppeal at unban.app/g/1.`);
});

// `notifyTarget` swallows its own failures so a DM never stops a ban; this has to hold one level down too.
test('a failed lookup sends the DM without the notice instead of losing it', async () => {
	queryError = new Error('down');

	expect(await appendPunishmentNotice(BODY, '1', CASE_ACTION.KICK, logger)).toBe(BODY);
});

// Dropped whole, not sliced: a cut can halve an emoji or end the DM mid-URL, and a broken appeal link is
// worse than no appeal link.
test('a notice that would overflow a Discord message is dropped, leaving the DM clean', async () => {
	rows = [{ scope: 'DEFAULT', content: 'x'.repeat(2_100) }];

	expect(await appendPunishmentNotice(BODY, '1', CASE_ACTION.WARN, logger)).toBe(BODY);
});

// UNBAN has no `automoderator_notice_scope` member, so asking the database about it is an error rather than an
// empty result. Nothing can reach here with one today; the guard is what keeps that true cheaply.
test('an action the notice enum has no member for never reaches the database', async () => {
	rows = [{ scope: 'DEFAULT', content: 'Read the rules.' }];

	expect(await appendPunishmentNotice(BODY, '1', CASE_ACTION.UNBAN, logger)).toBe(BODY);
	expect(lastValues).toStrictEqual([]);
});
