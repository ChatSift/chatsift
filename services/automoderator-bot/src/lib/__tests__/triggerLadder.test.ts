import { beforeEach, expect, test, vi } from 'vitest';
import type { ModerationRequest } from '../moderation.js';

let count = 1;
let hasLadder = true;
let rung: { actionType: string; durationSeconds: number | null } | null = null;
let requests: ModerationRequest[] = [];
let suppressed = false;
let claimed: string | null = '1';
let claimError: Error | null = null;
let claimedKeys: string[] = [];

// The two statements `applyTriggerLadder` makes, told apart by which one is asked for -- the increment returns
// a count (and nothing at all when the guild has no ladder, which is what its `EXISTS` guard produces), and the
// rung lookup returns a punishment row or nothing.
vi.mock('@chatsift/backend-core', () => ({
	ENV: { IS_PRODUCTION: false },
	getContext: () => ({
		db: async (strings: TemplateStringsArray) =>
			strings.join('').includes('INSERT INTO automoderator_trigger_counts')
				? hasLadder
					? [{ count }]
					: []
				: rung
					? [rung]
					: [],
		redis: {
			async set(key: string) {
				claimedKeys.push(key);
				if (claimError) {
					throw claimError;
				}

				return claimed;
			},
		},
	}),
	publishRealtimeInvalidate: async () => undefined,
}));

vi.mock('../moderation.js', () => ({
	async applyModerationAction(request: ModerationRequest) {
		requests.push(request);
		return { case: { caseId: 7, guildId: 'guild', logMessageId: null }, suppressed, logChannelId: null };
	},
}));

const traces: { action: string | null; ladderCount?: number }[] = [];
vi.mock('../decisionTrace.js', () => ({
	traceDecision(_logger: unknown, trace: { action: string | null; ladderCount?: number }) {
		traces.push(trace);
	},
}));

const { applyTriggerLadder } = await import('../triggerLadder.js');

const LOGGER = { info() {}, warn() {}, error() {} } as never;
const TARGET = { id: 'member', tag: 'member#0' };

async function trip(messageId = 'message') {
	return applyTriggerLadder({ guildId: 'guild', messageId, target: TARGET }, LOGGER);
}

beforeEach(() => {
	count = 1;
	hasLadder = true;
	rung = null;
	requests = [];
	suppressed = false;
	claimed = '1';
	claimError = null;
	claimedKeys = [];
	traces.length = 0;
});

// Most guilds with a ladder have most counts landing in a gap. Those still have to come back with the count --
// "they're on 4 and your ladder starts at 5" is the answer to "why wasn't anything done", and it is invisible
// if nothing carries the number.
test('a count with no rung reports the count and punishes nobody', async () => {
	count = 4;

	const result = await trip();

	expect(result).toEqual({ count: 4, summary: null });
	expect(requests).toEqual([]);
	expect(traces).toContainEqual({
		runner: 'trigger_ladder',
		guildId: 'guild',
		targetId: 'member',
		ladderCount: 4,
		action: null,
	});
});

// The growth guard: a guild running the filters with no rungs and no decay would otherwise accumulate a
// permanent row per offending member forever, to feed a ladder that does not exist.
test('a guild with no ladder configured has nothing counted against it', async () => {
	hasLadder = false;

	expect(await trip()).toBeNull();
	expect(requests).toEqual([]);
});

test('a matching rung punishes the member and names the case it filed', async () => {
	count = 3;
	rung = { actionType: 'BAN', durationSeconds: null };

	const result = await trip();

	expect(result).toEqual({ count: 3, summary: 'Banned', caseRef: '#7' });
	expect(requests[0]).toMatchObject({
		action: 'BAN',
		guildId: 'guild',
		target: TARGET,
		// No human authored this, so the case says so rather than naming whoever configured the ladder.
		mod: null,
		source: 'ladder',
		reason: 'Automatic punishment for tripping the filters 3 times',
	});
	expect('durationMs' in requests[0]!).toBe(false);
});

test('seconds become milliseconds for a timed rung', async () => {
	count = 2;
	rung = { actionType: 'MUTE', durationSeconds: 600 };

	await trip();

	expect(requests[0]!.durationMs).toBe(600_000);
});

test('the reason reads naturally at one trigger', async () => {
	count = 1;
	rung = { actionType: 'KICK', durationSeconds: null };

	await trip();

	expect(requests[0]!.reason).toBe('Automatic punishment for tripping the filters 1 time');
});

// Dry-run has to be able to demonstrate the ladder, so the case is still filed and the count still moves -- the
// summary is what says nothing actually happened.
test('a suppressed action says what it would have done', async () => {
	count = 3;
	rung = { actionType: 'MUTE', durationSeconds: 60 };
	suppressed = true;

	expect((await trip())?.summary).toBe('Would have muted');
});

// A migration that adds an action ahead of the code that handles it. Without the guard this indexes the action
// map to `undefined` and hands that to `applyModerationAction` as the case action.
test('an action this build does not understand punishes nobody', async () => {
	count = 3;
	rung = { actionType: 'DISINTEGRATE', durationSeconds: null };

	const result = await trip();

	expect(result?.summary).toBe('Nothing done: this ladder step names an unrecognised action');
	expect(requests).toEqual([]);
});

// The filters re-run on `MESSAGE_UPDATE` deliberately, to catch a link edited in after posting. A message that
// survived its first hit -- one the bot could not delete, or was not allowed to in dry-run -- would otherwise
// cost a rung per typo fix.
test('a message already counted is never counted again', async () => {
	count = 3;
	rung = { actionType: 'BAN', durationSeconds: null };
	claimed = null;

	expect(await trip()).toBeNull();
	expect(requests).toEqual([]);
});

test('the claim is keyed on the message, so a different message still counts', async () => {
	await trip('first');
	await trip('second');

	expect(claimedKeys).toEqual([
		'automoderator:trigger-count:guild:first',
		'automoderator:trigger-count:guild:second',
	]);
});

// Failing closed would stop the ladder entirely for as long as redis is down; failing open counts twice at
// worst. Between "moderation happens twice" and "moderation stops", the first is the recoverable one.
test('a redis outage lets the count through rather than stopping the ladder', async () => {
	count = 3;
	rung = { actionType: 'KICK', durationSeconds: null };
	claimError = new Error('redis is down');

	expect((await trip())?.summary).toBe('Kicked');
});
