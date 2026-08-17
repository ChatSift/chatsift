import { expect, test } from 'vitest';
import { describeStep, formatDurationInput, parseDurationInput } from '../ladderDisplay';

// The property that matters: opening a step and pressing Save without touching anything must not change it.
// `formatCaseDuration` rounds to the nearest unit, which would quietly turn 90 minutes into two hours.
test('a duration survives a round trip through the field', () => {
	for (const seconds of [1, 59, 90, 3_600, 5_400, 86_400, 604_800, 2_419_200, 7_260]) {
		const text = formatDurationInput(seconds);
		expect(parseDurationInput(text, 'BAN'), `${seconds}s rendered as "${text}"`).toStrictEqual({
			ok: true,
			seconds,
		});
	}
});

test('the largest exact unit wins', () => {
	expect(formatDurationInput(3_600)).toBe('1h');
	expect(formatDurationInput(86_400)).toBe('1d');
	expect(formatDurationInput(604_800)).toBe('1w');
	// A month is 28 days in this grammar, so 28 days reads as a month rather than four weeks.
	expect(formatDurationInput(2_419_200)).toBe('1mo');
	// Divides evenly by nothing above minutes.
	expect(formatDurationInput(5_400)).toBe('90m');
	expect(formatDurationInput(null)).toBe('');
});

test('an empty box means permanent for a ban and a mistake for a mute', () => {
	expect(parseDurationInput('', 'BAN')).toStrictEqual({ ok: true, seconds: null });
	expect(parseDurationInput('  ', 'MUTE')).toStrictEqual({ ok: false, message: 'A mute needs a duration.' });
});

// A kick's box is disabled rather than hidden, so whatever text is left behind in it must not block the save.
test('a kick ignores its duration box entirely', () => {
	expect(parseDurationInput('7d', 'KICK')).toStrictEqual({ ok: true, seconds: null });
	expect(parseDurationInput('', 'KICK')).toStrictEqual({ ok: true, seconds: null });
});

test('a mute is held to Discord ceiling, a ban is not', () => {
	expect(parseDurationInput('29d', 'MUTE').ok).toBe(false);
	expect(parseDurationInput('28d', 'MUTE')).toStrictEqual({ ok: true, seconds: 2_419_200 });
	expect(parseDurationInput('365d', 'BAN')).toStrictEqual({ ok: true, seconds: 31_536_000 });
});

test('nonsense is rejected rather than silently read as minutes', () => {
	expect(parseDurationInput('soon', 'BAN').ok).toBe(false);
});

test('a step describes itself in prose', () => {
	expect(describeStep('MUTE', 3_600)).toBe('Mute for 1 hour');
	expect(describeStep('BAN', 604_800)).toBe('Ban for 1 week');
	expect(describeStep('BAN', null)).toBe('Ban permanently');
	expect(describeStep('KICK', null)).toBe('Kick');
});
