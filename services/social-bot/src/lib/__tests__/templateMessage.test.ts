import { expect, test } from 'vitest';
import { DEFAULT_LEVEL_UP_MESSAGE, templateLevelUpMessage, templateSocialInteraction } from '../templateMessage.js';

const LEVEL_UP = {
	earnedRewards: ' and received: Regular',
	guildName: 'Test Server',
	level: '5',
	username: 'didinele',
};

test('the default level-up message renders every placeholder', () => {
	expect(templateLevelUpMessage(DEFAULT_LEVEL_UP_MESSAGE, LEVEL_UP)).toBe(
		'didinele, you just reached level 5 in Test Server and received: Regular!',
	);
});

test('earnedRewards carries its own leading space', () => {
	// The template appends it straight after the guild name, so an empty value has to leave no gap behind.
	expect(templateLevelUpMessage(DEFAULT_LEVEL_UP_MESSAGE, { ...LEVEL_UP, earnedRewards: '' })).toBe(
		'didinele, you just reached level 5 in Test Server!',
	);
});

test('the strict single-space syntax is preserved', () => {
	// Legacy's exact regex. ModMail's template helper tolerates surrounding whitespace; Social deliberately does
	// Whitespace inside the braces is tolerated, matching ModMail. Legacy Social required exactly one space on
	// each side, so a migrated template containing `{{username}}` starts resolving where it used to render
	// literally -- the deliberate cost of one shared syntax across the products.
	expect(templateLevelUpMessage('{{username}}', LEVEL_UP)).toBe('didinele');
	expect(templateLevelUpMessage('{{  username  }}', LEVEL_UP)).toBe('didinele');
	expect(templateLevelUpMessage('{{ username }}', LEVEL_UP)).toBe('didinele');
});

test('an unknown placeholder renders as a marker rather than throwing', () => {
	expect(templateLevelUpMessage('hi {{ nope }}', LEVEL_UP)).toBe('hi [unknown template nope]');
});

test('prototype keys are not reachable as placeholders', () => {
	expect(templateLevelUpMessage('{{ constructor }}', LEVEL_UP)).toBe('[unknown template constructor]');
});

test('interaction content renders author and targets', () => {
	expect(templateSocialInteraction('{{ author }} hugs {{ targets }}', { author: '<@1>', targets: '<@2>, <@3>' })).toBe(
		'<@1> hugs <@2>, <@3>',
	);
});

test('an interaction invoked with no targets renders an empty string, not a marker', () => {
	// `targets` is a known key that happens to be empty -- distinct from a placeholder nobody defined.
	expect(templateSocialInteraction('{{ author }} waves at {{ targets }}', { author: '<@1>', targets: '' })).toBe(
		'<@1> waves at ',
	);
});

test('every occurrence is replaced, not just the first', () => {
	expect(templateSocialInteraction('{{ author }} {{ author }}', { author: '<@1>', targets: '' })).toBe('<@1> <@1>');
});
