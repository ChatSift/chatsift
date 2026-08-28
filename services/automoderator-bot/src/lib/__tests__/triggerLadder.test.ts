import { beforeEach, expect, test, vi } from 'vitest';
import type { ModerationRequest } from '../moderation.js';

let count = 1;
let rung: { actionType: string; durationSeconds: number | null } | null = null;
let requests: ModerationRequest[] = [];
let suppressed = false;

// The two statements `applyTriggerLadder` makes, told apart by which one is asked for -- the increment returns
// a count, the rung lookup returns a punishment row or nothing.
vi.mock('@chatsift/backend-core', () => ({
	ENV: { IS_PRODUCTION: false },
	getContext: () => ({
		db: async (strings: TemplateStringsArray) =>
			strings.join('').includes('INSERT INTO automoderator_trigger_counts') ? [{ count }] : rung ? [rung] : [],
	}),
	publishRealtimeInvalidate: async () => undefined,
}));

vi.mock('../moderation.js', () => ({
	async applyModerationAction(request: ModerationRequest) {
		requests.push(request);
		return { case: { caseId: 7 }, suppressed };
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

async function trip() {
	return applyTriggerLadder({ guildId: 'guild', target: TARGET }, LOGGER);
}

beforeEach(() => {
	count = 1;
	rung = null;
	requests = [];
	suppressed = false;
	traces.length = 0;
});

// Most guilds have no ladder at all, and most counts on a configured one land in a gap. Both have to come back
// with the count anyway -- "they're on 4 and your ladder starts at 5" is the answer to "why wasn't anything
// done", and it is invisible if nothing carries the number.
test('a count with no rung reports the count and punishes nobody', async () => {
	count = 4;

	const result = await trip();

	expect(result).toEqual({ count: 4, summary: null });
	expect(requests).toEqual([]);
	expect(traces).toEqual([{ runner: 'trigger_ladder', guildId: 'guild', targetId: 'member', ladderCount: 4, action: null }]);
});

test('a matching rung punishes the member and names the case it filed', async () => {
	count = 3;
	rung = { actionType: 'BAN', durationSeconds: null };

	const result = await trip();

	expect(result).toEqual({ count: 3, summary: 'Banned', caseId: 7 });
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

	expect((await trip()).summary).toBe('Would have muted');
});

// A migration that adds an action ahead of the code that handles it. Without the guard this indexes the action
// map to `undefined` and hands that to `applyModerationAction` as the case action.
test('an action this build does not understand punishes nobody', async () => {
	count = 3;
	rung = { actionType: 'DISINTEGRATE', durationSeconds: null };

	const result = await trip();

	expect(result.summary).toBe('Nothing done: this ladder step names an unrecognised action');
	expect(requests).toEqual([]);
});
