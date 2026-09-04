import type { AutomoderatorCases, AutomoderatorWarnPunishments } from '@chatsift/db';
import { expect, test, vi } from 'vitest';
import { buildLadderRequest } from '../warnLadder.js';

// `buildLadderRequest` is pure, but its module reaches `cases.js` for the warn count, which pulls in the real
// `ENV` -- parsed at import time and unhappy without a full environment.
vi.mock('@chatsift/backend-core', () => ({
	ENV: { IS_PRODUCTION: false },
	getContext: () => ({ db: () => [] }),
	publishRealtimeInvalidate: async () => undefined,
}));

const WARN_CASE = {
	id: 1 as AutomoderatorCases['id'],
	guildId: '1',
	caseId: 42,
	targetId: '2',
	targetTag: 'target',
} as AutomoderatorCases;

const MOD = { id: '3', tag: 'moderator' };

interface RungOverrides {
	actionType?: string;
	durationSeconds?: number | null;
	warns?: number;
}

function rung(overrides: RungOverrides): AutomoderatorWarnPunishments {
	return {
		guildId: '1',
		warns: 3,
		actionType: 'MUTE',
		durationSeconds: null,
		...overrides,
	} as unknown as AutomoderatorWarnPunishments;
}

test('a rung punishes the warned member, referencing the warn that tripped it', () => {
	const request = buildLadderRequest({ punishment: rung({ actionType: 'KICK' }), warns: 3 }, WARN_CASE, MOD);

	expect(request.action).toBe('KICK');
	expect(request.target).toStrictEqual({ id: '2', tag: 'target' });
	// The *case number*, not the row id -- that's what a moderator reads off the log embed.
	expect(request.refId).toBe(42);
	expect(request.source).toBe('ladder');
	expect(request.reason).toBe('Automatic punishment for reaching 3 warnings');
});

// The warning moderator is carried onto the punishment, which is legacy's behaviour: they took the action that
// tripped it, and the reason above says the punishment itself was automatic.
test('the warning moderator is carried onto the punishment', () => {
	expect(buildLadderRequest({ punishment: rung({}), warns: 3 }, WARN_CASE, MOD).mod).toStrictEqual(MOD);
	expect(buildLadderRequest({ punishment: rung({}), warns: 3 }, WARN_CASE, null).mod).toBeNull();
});

test('seconds become milliseconds, and no duration means no key at all', () => {
	const timed = buildLadderRequest({ punishment: rung({ durationSeconds: 3_600 }), warns: 3 }, WARN_CASE, MOD);
	expect(timed.durationMs).toBe(3_600_000);

	// Absent rather than undefined-valued: `applyModerationAction` branches on `request.durationMs` being
	// truthy to decide whether a ban is temporary, and a permanent one must not carry the key.
	const permanent = buildLadderRequest({ punishment: rung({ actionType: 'BAN' }), warns: 5 }, WARN_CASE, MOD);
	expect('durationMs' in permanent).toBe(false);
});

// A rung can only ever be MUTE/KICK/BAN, so it can't recurse -- but the flag is what makes that a property of
// this code rather than of a CREATE TYPE two packages away.
test('a rung never re-enters the ladder', () => {
	expect(buildLadderRequest({ punishment: rung({}), warns: 3 }, WARN_CASE, MOD).skipLadder).toBe(true);
});

test('the reason reads naturally at one warning', () => {
	expect(buildLadderRequest({ punishment: rung({ warns: 1 }), warns: 1 }, WARN_CASE, MOD).reason).toBe(
		'Automatic punishment for reaching 1 warning',
	);
});
