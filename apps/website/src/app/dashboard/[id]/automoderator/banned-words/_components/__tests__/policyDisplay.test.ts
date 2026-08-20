import { expect, test } from 'vitest';
import { describePolicy, DURATION_RULE, parsePolicyDuration } from '../policyDisplay';

// Mirrors `automoderator_banword_policies_duration_check`. A mute is a Discord timeout, which has no
// open-ended form; a ban reads both ways; the other three have no duration to serve.
test('only mutes and bans take a duration, and only a mute has to', () => {
	expect(DURATION_RULE).toStrictEqual({
		WARN: 'forbidden',
		MUTE: 'required',
		KICK: 'forbidden',
		BAN: 'optional',
		REPORT: 'forbidden',
	});
});

test('a mute without a duration is rejected, and one past 28 days is too', () => {
	expect(parsePolicyDuration('', 'MUTE')).toStrictEqual({ ok: false, message: 'A mute needs a duration.' });
	expect(parsePolicyDuration('29d', 'MUTE')).toStrictEqual({
		ok: false,
		message: 'Discord timeouts cap out at 28 days.',
	});
	expect(parsePolicyDuration('2h', 'MUTE')).toStrictEqual({ ok: true, seconds: 7_200 });
});

// The ceiling is a timeout's, not a ban's: a ban's expiry is honoured by our own scheduler rather than by
// Discord, so a ninety-day one is a perfectly ordinary row.
test('a ban may be permanent or longer than a timeout could ever be', () => {
	expect(parsePolicyDuration('', 'BAN')).toStrictEqual({ ok: true, seconds: null });
	expect(parsePolicyDuration('90d', 'BAN')).toStrictEqual({ ok: true, seconds: 7_776_000 });
});

// Whatever is typed in a field the action has no use for is discarded rather than rejected -- the field is
// disabled, so a stale value left over from switching actions must not block the save.
test('an action with no duration ignores whatever is in the box', () => {
	expect(parsePolicyDuration('7d', 'WARN')).toStrictEqual({ ok: true, seconds: null });
	expect(parsePolicyDuration('nonsense', 'REPORT')).toStrictEqual({ ok: true, seconds: null });
});

test('a policy describes itself the way the list renders it', () => {
	expect(describePolicy('BAN', null)).toBe('Ban permanently');
	expect(describePolicy('MUTE', 3_600)).toBe('Mute for 1 hour');
	expect(describePolicy('MUTE', 7_200)).toBe('Mute for 2 hours');
	expect(describePolicy('WARN', null)).toBe('Warn');
});
