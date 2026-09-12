import { expect, test, vi } from 'vitest';
import { describeAppealDelivery } from '../appealDelivery.js';

// Only so the module graph resolves: importing it reaches `context.js`, which parses the whole environment at
// import time. Nothing under test here touches the context -- `describeAppealDelivery` is a pure function of
// its argument, which is why it is the half worth testing without a database.
vi.mock('../../context.js', () => ({ getContext: () => ({}) }));

/**
 * The sentence a moderator reads on the dashboard's trail and at the end of their ephemeral reply in Discord
 * (#232 P6). Tested as a table because the point of it is that the two outcomes worth acting on --
 * "they were not told" and "they might not have been" -- survive being skim-read, and the way that breaks is
 * one cheerful-sounding branch, not a crash.
 */

test('a delivered decision says so, and mentions a re-add when there was one', () => {
	expect(describeAppealDelivery({ dm: 'sent', rejoin: 'added' })).toBe(
		'DMed them the decision and put them back in the server.',
	);

	expect(describeAppealDelivery({ dm: 'sent', rejoin: 'invited' })).toBe(
		'DMed them the decision, with an invite back.',
	);

	expect(describeAppealDelivery({ dm: 'sent', rejoin: 'none' })).toBe('DMed them the decision.');
});

test('a refused DM says they have not been told, whatever else worked', () => {
	for (const rejoin of ['added', 'invited', 'none'] as const) {
		expect(describeAppealDelivery({ dm: 'blocked', rejoin })).toContain('have not been told');
	}

	// The re-add is still worth naming: it is the half that landed, and a moderator chasing this needs to know
	// the person is already back in the server.
	expect(describeAppealDelivery({ dm: 'blocked', rejoin: 'added' })).toContain('put back in the server');
});

test('a failed send is reported as uncertain rather than as either outcome', () => {
	const sentence = describeAppealDelivery({ dm: 'failed', rejoin: 'none' });

	expect(sentence).toContain('may not have been told');
	expect(sentence).not.toContain('have not been told');
});

test('a silent denial describes nothing', () => {
	expect(describeAppealDelivery({ dm: 'skipped', rejoin: 'none' })).toBe('Nothing was sent.');
});

test('a rejoin that produced no invite is never described as one', () => {
	// The pairing `deliverAppealDecision` guards by downgrading `'invited'` to `'none'` when no invite could be
	// minted: this sentence and the appellant's DM would otherwise both promise a link nobody has.
	expect(describeAppealDelivery({ dm: 'sent', rejoin: 'none' })).not.toContain('invite');
});
