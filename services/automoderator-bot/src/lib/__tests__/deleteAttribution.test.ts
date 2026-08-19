import { beforeEach, expect, test } from 'vitest';
import { clearDeleteAttribution, findDeleteModerator, recordMessageDeleteAudit } from '../deleteAttribution.js';

const GUILD = '1425493115053019310';
const CHANNEL = '1425493115053019311';
const OTHER_CHANNEL = '1425493115053019312';
const AUTHOR = '110000000000000001';
const OTHER_AUTHOR = '110000000000000002';
const MOD = '120000000000000001';

// The buffer is module state shared by every guild, so each test starts from empty.
beforeEach(() => {
	clearDeleteAttribution();
});

test('a delete with no audit entry is unattributed', () => {
	expect(findDeleteModerator(GUILD, CHANNEL, AUTHOR)).toBeNull();
});

test('an audit entry attributes the delete it describes', () => {
	recordMessageDeleteAudit(GUILD, CHANNEL, AUTHOR, MOD, 1_000);

	expect(findDeleteModerator(GUILD, CHANNEL, AUTHOR, 1_500)).toBe(MOD);
});

test('attribution is scoped to the channel and the author it was recorded for', () => {
	recordMessageDeleteAudit(GUILD, CHANNEL, AUTHOR, MOD, 1_000);

	expect(findDeleteModerator(GUILD, OTHER_CHANNEL, AUTHOR, 1_500)).toBeNull();
	expect(findDeleteModerator(GUILD, CHANNEL, OTHER_AUTHOR, 1_500)).toBeNull();
	expect(findDeleteModerator('999', CHANNEL, AUTHOR, 1_500)).toBeNull();
});

test('one audit entry covers a whole burst, which is what a purge produces', () => {
	// Discord aggregates repeated deletes by one moderator on one author in one channel into a single audit
	// entry, so only the first one ever emits GUILD_AUDIT_LOG_ENTRY_CREATE.
	recordMessageDeleteAudit(GUILD, CHANNEL, AUTHOR, MOD, 1_000);

	for (const at of [1_100, 2_000, 5_000, 30_000]) {
		expect(findDeleteModerator(GUILD, CHANNEL, AUTHOR, at)).toBe(MOD);
	}
});

test('attribution expires, so a later self-delete is not blamed on the last moderator', () => {
	recordMessageDeleteAudit(GUILD, CHANNEL, AUTHOR, MOD, 1_000);

	expect(findDeleteModerator(GUILD, CHANNEL, AUTHOR, 61_000)).toBeNull();
});

test('a repeated audit entry refreshes the window rather than aging out mid-purge', () => {
	recordMessageDeleteAudit(GUILD, CHANNEL, AUTHOR, MOD, 1_000);
	recordMessageDeleteAudit(GUILD, CHANNEL, AUTHOR, MOD, 50_000);

	// Past the original entry's expiry, inside the refreshed one's.
	expect(findDeleteModerator(GUILD, CHANNEL, AUTHOR, 100_000)).toBe(MOD);
});

test('a second moderator deleting from the same author replaces the attribution', () => {
	const otherMod = '120000000000000002';
	recordMessageDeleteAudit(GUILD, CHANNEL, AUTHOR, MOD, 1_000);
	recordMessageDeleteAudit(GUILD, CHANNEL, AUTHOR, otherMod, 2_000);

	expect(findDeleteModerator(GUILD, CHANNEL, AUTHOR, 2_500)).toBe(otherMod);
});

test('recording prunes entries that have already expired', () => {
	recordMessageDeleteAudit(GUILD, CHANNEL, AUTHOR, MOD, 1_000);
	// A wholly unrelated delete far in the future, which is what triggers the sweep.
	recordMessageDeleteAudit(GUILD, OTHER_CHANNEL, OTHER_AUTHOR, MOD, 500_000);

	expect(findDeleteModerator(GUILD, CHANNEL, AUTHOR, 500_000)).toBeNull();
});
