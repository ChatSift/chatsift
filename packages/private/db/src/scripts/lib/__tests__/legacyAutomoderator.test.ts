import { Buffer } from 'node:buffer';
import { describe, expect, test } from 'vitest';
import { decryptWithKey, encryptWithKey } from '../../../lib/crypt.js';
import type { CopyContext, LegacyCase } from '../legacyAutomoderator.js';
import {
	decodeBanwordFlags,
	decodeFilterIgnores,
	isPublicSuffixLookalike,
	mapCase,
	normalizeLegacyDomain,
} from '../legacyAutomoderator.js';

const NOW = new Date('2026-09-22T16:00:00.000Z');
const APPLICATION_ID = '953003854570618911';

function context(): CopyContext {
	return { adjustments: [], encryptionKey: 'x'.repeat(44), now: NOW, pardonActorId: APPLICATION_ID };
}

function legacyCase(overrides: Partial<LegacyCase> = {}): LegacyCase {
	return {
		id: 1,
		guildId: '1',
		caseId: 1,
		refId: null,
		targetId: '2',
		targetTag: 'someone#0001',
		modId: '3',
		modTag: 'mod#0002',
		actionType: 'ban',
		reason: null,
		expiresAt: null,
		pardonedBy: null,
		logMessageId: null,
		createdAt: new Date('2020-01-01T00:00:00.000Z'),
		useTimeouts: false,
		hasPendingTask: false,
		...overrides,
	};
}

const days = (count: number): Date => new Date(NOW.getTime() - count * 86_400_000);

describe('mapCase — lifted_at', () => {
	// The single most destructive thing this migration could get wrong. `lifted_at IS NULL` alongside a past
	// `expires_at` is exactly what the expiry sweep claims, so marking historic tempbans un-lifted would
	// unban, on cutover day, every person this bot has ever temporarily banned -- including everyone who was
	// banned again since.
	test('an expired tempban legacy already lifted is recorded as lifted', () => {
		const { value } = mapCase(
			legacyCase({ actionType: 'ban', expiresAt: days(400), hasPendingTask: false }),
			context(),
			{ autoPardonDays: new Map(), duplicatePlan: new Map() },
		);

		expect(value.liftedAt).toEqual(days(400));
	});

	test('a tempban legacy still owed an unban is left for the sweep, even when overdue', () => {
		const { value } = mapCase(legacyCase({ actionType: 'ban', expiresAt: days(3), hasPendingTask: true }), context(), {
			autoPardonDays: new Map(),
			duplicatePlan: new Map(),
		});

		expect(value.liftedAt).toBeNull();
	});

	test('a tempban that has not expired yet is left for the sweep even with no pending task', () => {
		const future = new Date(NOW.getTime() + 86_400_000);
		const { value } = mapCase(legacyCase({ actionType: 'ban', expiresAt: future, hasPendingTask: false }), context(), {
			autoPardonDays: new Map(),
			duplicatePlan: new Map(),
		});

		expect(value.liftedAt).toBeNull();
	});

	test('an expired mute is never marked lifted — the sweep only claims bans', () => {
		const { value } = mapCase(
			legacyCase({ actionType: 'mute', expiresAt: days(30), hasPendingTask: false }),
			context(),
			{ autoPardonDays: new Map(), duplicatePlan: new Map() },
		);

		expect(value.liftedAt).toBeNull();
		expect(value.actionType).toBe('MUTE');
	});

	test('a permanent ban carries neither an expiry nor a lift', () => {
		const { value } = mapCase(legacyCase({ actionType: 'ban', expiresAt: null }), context(), {
			autoPardonDays: new Map(),
			duplicatePlan: new Map(),
		});

		expect(value.expiresAt).toBeNull();
		expect(value.liftedAt).toBeNull();
	});
});

describe('mapCase — pre-pardoning', () => {
	const autoPardonDays = new Map([['1', 30]]);

	test('a warn past its guild threshold is pardoned by the application', () => {
		const { prePardoned, value } = mapCase(legacyCase({ actionType: 'warn', createdAt: days(90) }), context(), {
			autoPardonDays,
			duplicatePlan: new Map(),
		});

		expect(prePardoned).toBe(true);
		expect(value.pardonedBy).toBe(APPLICATION_ID);
	});

	test('a warn inside the window is left alone', () => {
		const { prePardoned, value } = mapCase(legacyCase({ actionType: 'warn', createdAt: days(5) }), context(), {
			autoPardonDays,
			duplicatePlan: new Map(),
		});

		expect(prePardoned).toBe(false);
		expect(value.pardonedBy).toBeNull();
	});

	test('a guild that never configured auto-pardon keeps every warn', () => {
		const { prePardoned, value } = mapCase(legacyCase({ actionType: 'warn', createdAt: days(4_000) }), context(), {
			autoPardonDays: new Map(),
			duplicatePlan: new Map(),
		});

		expect(prePardoned).toBe(false);
		expect(value.pardonedBy).toBeNull();
	});

	test('an already-pardoned warn keeps whoever pardoned it', () => {
		const { prePardoned, value } = mapCase(
			legacyCase({ actionType: 'warn', createdAt: days(90), pardonedBy: '42' }),
			context(),
			{ autoPardonDays, duplicatePlan: new Map() },
		);

		expect(prePardoned).toBe(false);
		expect(value.pardonedBy).toBe('42');
	});

	test('auto-pardon applies to warns only, however old the case', () => {
		for (const actionType of ['ban', 'kick', 'mute', 'softban']) {
			const { prePardoned } = mapCase(legacyCase({ actionType, createdAt: days(4_000) }), context(), {
				autoPardonDays,
				duplicatePlan: new Map(),
			});

			expect(prePardoned, actionType).toBe(false);
		}
	});
});

describe('mapCase — numbering', () => {
	test('a case keeps the number moderators know it by', () => {
		const { value } = mapCase(legacyCase({ id: 77, caseId: 12 }), context(), {
			autoPardonDays: new Map(),
			duplicatePlan: new Map(),
		});

		expect(value.caseId).toBe(12);
	});

	test('a case whose number legacy handed out twice takes its planned replacement', () => {
		const { value } = mapCase(legacyCase({ id: 77, caseId: 12 }), context(), {
			autoPardonDays: new Map(),
			duplicatePlan: new Map([[77, 501]]),
		});

		expect(value.caseId).toBe(501);
	});

	test('an unrecognised legacy action aborts rather than reaching Postgres', () => {
		expect(() =>
			mapCase(legacyCase({ actionType: 'timeout' }), context(), {
				autoPardonDays: new Map(),
				duplicatePlan: new Map(),
			}),
		).toThrow(/no mapping|unrecognized/iu);
	});
});

describe('decodeFilterIgnores', () => {
	// `BitField.makeFlags(['urls', 'files', 'invites', 'words', 'automod', 'global'])`.
	test('maps the three filters that survived the port', () => {
		expect(decodeFilterIgnores(1n)).toEqual(['URLS']);
		expect(decodeFilterIgnores(4n)).toEqual(['INVITES']);
		expect(decodeFilterIgnores(16n)).toEqual(['ANTISPAM']);
		expect(decodeFilterIgnores(21n)).toEqual(['URLS', 'INVITES', 'ANTISPAM']);
	});

	test('drops files, words and global, which have no target filter', () => {
		expect(decodeFilterIgnores(2n)).toEqual([]);
		expect(decodeFilterIgnores(8n)).toEqual([]);
		expect(decodeFilterIgnores(32n)).toEqual([]);
		expect(decodeFilterIgnores(42n)).toEqual([]);
	});

	test('an exemption from everything becomes the three that exist', () => {
		expect(decodeFilterIgnores(63n)).toEqual(['URLS', 'INVITES', 'ANTISPAM']);
	});

	test('reads the BIGINT postgres.js hands back as a string', () => {
		expect(decodeFilterIgnores('21')).toEqual(['URLS', 'INVITES', 'ANTISPAM']);
	});
});

describe('decodeBanwordFlags', () => {
	// `BitField.makeFlags(['word', 'warn', 'mute', 'ban', 'report', 'name', 'kick'])`.
	test('decodes every member, including the ones with no modern equivalent', () => {
		expect(decodeBanwordFlags(1n)).toEqual(['word']);
		expect(decodeBanwordFlags(32n)).toEqual(['name']);
		expect(decodeBanwordFlags(64n)).toEqual(['kick']);
		expect(decodeBanwordFlags(9n)).toEqual(['word', 'ban']);
		expect(decodeBanwordFlags(127n)).toEqual(['word', 'warn', 'mute', 'ban', 'report', 'name', 'kick']);
	});

	test('an empty bitfield decodes to nothing rather than throwing', () => {
		expect(decodeBanwordFlags(0n)).toEqual([]);
	});
});

describe('normalizeLegacyDomain', () => {
	test('lowercases and trims, which legacy never did', () => {
		expect(normalizeLegacyDomain('  Example.COM ')).toBe('example.com');
	});

	test('strips a scheme, path, query and port', () => {
		expect(normalizeLegacyDomain('https://cdn.example.com/a/b?c=1#d')).toBe('cdn.example.com');
		expect(normalizeLegacyDomain('//example.com')).toBe('example.com');
		expect(normalizeLegacyDomain('ftp://example.com')).toBe('example.com');
		expect(normalizeLegacyDomain('example.com:8080')).toBe('example.com');
		expect(normalizeLegacyDomain('user@example.com')).toBe('example.com');
	});

	test('rejects what the new matcher could never match', () => {
		expect(normalizeLegacyDomain('')).toBeNull();
		expect(normalizeLegacyDomain('   ')).toBeNull();
		expect(normalizeLegacyDomain('localhost')).toBeNull();
		expect(normalizeLegacyDomain('example..com')).toBeNull();
		expect(normalizeLegacyDomain('.example.com')).toBeNull();
	});
});

describe('isPublicSuffixLookalike', () => {
	// Legacy reduced every entry to its last two labels, so a guild that allowlisted `shop.example.co.uk`
	// has a row reading `co.uk` -- which under the new suffix matcher allows every .co.uk domain there is.
	test('flags the registry suffixes legacy reduction produced', () => {
		expect(isPublicSuffixLookalike('co.uk')).toBe(true);
		expect(isPublicSuffixLookalike('com.br')).toBe(true);
		expect(isPublicSuffixLookalike('ac.nz')).toBe(true);
	});

	test('leaves real sites alone', () => {
		expect(isPublicSuffixLookalike('example.com')).toBe(false);
		expect(isPublicSuffixLookalike('example.co.uk')).toBe(false);
		expect(isPublicSuffixLookalike('cdn.example.com')).toBe(false);
		// Two labels, second-level label is a registry one, but the TLD is not a two-letter ccTLD.
		expect(isPublicSuffixLookalike('co.com')).toBe(false);
	});
});

describe('encryptWithKey', () => {
	// The migration is the first writer of an encrypted column that does not go through
	// `@chatsift/backend-core`'s context-reading wrapper, so what actually matters is that the wire format
	// round-trips -- a webhook token the API cannot decrypt is a log channel that silently stops working.
	const key = Buffer.alloc(32, 7).toString('base64');

	test('round-trips a webhook token', () => {
		const token = 'a-webhook-token-with-/-and-+-in-it';
		expect(decryptWithKey(key, encryptWithKey(key, token))).toBe(token);
	});

	test('is randomised per call, so two rows never share a ciphertext', () => {
		expect(encryptWithKey(key, 'same')).not.toBe(encryptWithKey(key, 'same'));
	});

	test('lays out iv | ciphertext | tag, which is what decrypt expects', () => {
		const raw = Buffer.from(encryptWithKey(key, 'hello'), 'base64');
		expect(raw.length).toBe(12 + 'hello'.length + 16);
	});

	test('rejects a tampered ciphertext rather than returning rubbish', () => {
		const encrypted = Buffer.from(encryptWithKey(key, 'hello'), 'base64');
		// Inside the ciphertext, past the 12-byte IV, so GCM's tag no longer covers what is there.
		encrypted.writeUInt8(encrypted.readUInt8(13) ^ 0xff, 13);

		expect(() => decryptWithKey(key, encrypted.toString('base64'))).toThrow();
	});
});
