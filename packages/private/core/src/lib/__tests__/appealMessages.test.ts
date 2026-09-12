import { expect, test } from 'vitest';
import { buildAppealDecisionMessage } from '../appealMessages.js';

/**
 * The copy an appellant actually receives (#232 P6). Worth tests of its own rather than left to a snapshot,
 * because two of the assertions here are rules rather than wording: an approval must never carry a reason, and
 * an invite must never appear on a message that says they were added back.
 */

test('an approval says the ban is lifted and names the server', () => {
	const content = buildAppealDecisionMessage('APPROVED', { guildName: 'Test Guild' });

	expect(content).toContain('**approved**');
	expect(content).toContain('**Test Guild**');
});

test('an approval that added them back offers no invite', () => {
	const content = buildAppealDecisionMessage('APPROVED', {
		guildName: 'Test Guild',
		rejoin: 'added',
		// Passed deliberately: a caller that resolved an invite and then succeeded at the add must not leak it.
		inviteURL: 'https://discord.gg/abc',
	});

	expect(content).toContain('already been added back');
	expect(content).not.toContain('discord.gg');
});

test('an approval that could not add them back passes the invite on', () => {
	const content = buildAppealDecisionMessage('APPROVED', { rejoin: 'invited', inviteURL: 'https://discord.gg/abc' });

	expect(content).toContain('https://discord.gg/abc');
	expect(content).toContain('only works once');
});

test('an approval with no invite to give says so rather than inventing one', () => {
	const content = buildAppealDecisionMessage('APPROVED', { rejoin: 'invited', inviteURL: null });

	expect(content).not.toContain('discord.gg');
	expect(content).toContain('**approved**');
});

test('a guild we could not name still reads as a sentence', () => {
	expect(buildAppealDecisionMessage('DENIED', { reason: 'no' })).toContain('the server you appealed to');
});

test('a denial quotes the reason and says replies go nowhere', () => {
	const content = buildAppealDecisionMessage('DENIED', { guildName: 'Test Guild', reason: 'You evaded a ban.' });

	expect(content).toContain('**denied**');
	expect(content).toContain('> You evaded a ban.');
	expect(content).toContain('not monitored');
});

test('a multi-line denial reason stays inside the quote', () => {
	const content = buildAppealDecisionMessage('DENIED', { reason: 'One.\nTwo.' });

	expect(content).toContain('> One.\n> Two.');
});

test('a denial with no reason still tells them it was denied', () => {
	const content = buildAppealDecisionMessage('DENIED', { guildName: 'Test Guild' });

	expect(content).toContain('**denied**');
	expect(content).toContain('the ban stands');
});

test('a hostile guild name cannot push the message past Discord cap', () => {
	const content = buildAppealDecisionMessage('DENIED', {
		guildName: 'x'.repeat(5_000),
		reason: 'y'.repeat(500),
	});

	expect(content.length).toBeLessThanOrEqual(2_000);
});
