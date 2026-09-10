import { expect, test } from 'vitest';
import { parseTarget } from '../parseTarget';

test('a bare snowflake is a guild id', () => {
	expect(parseTarget('1425493115053019319')).toStrictEqual({ kind: 'guild', value: '1425493115053019319' });
	expect(parseTarget('  1425493115053019319  ')).toStrictEqual({ kind: 'guild', value: '1425493115053019319' });
});

test('every link shape an appellant might paste resolves to its invite code', () => {
	// Decision 12's whole point is that this works from a link they already have, whichever form it is in.
	for (const input of [
		'discord.gg/tgZ2pSgXXv',
		'https://discord.gg/tgZ2pSgXXv',
		'http://discord.gg/tgZ2pSgXXv',
		'https://discord.com/invite/tgZ2pSgXXv',
		'https://unban.app/tgZ2pSgXXv',
		'https://discord.gg/tgZ2pSgXXv/',
		'https://discord.gg/tgZ2pSgXXv?event=1',
	]) {
		expect(parseTarget(input), input).toStrictEqual({ kind: 'invite', value: 'tgZ2pSgXXv' });
	}
});

test('a bare code passes through unchanged', () => {
	expect(parseTarget('tgZ2pSgXXv')).toStrictEqual({ kind: 'invite', value: 'tgZ2pSgXXv' });
	// Vanity codes are ordinary words, hyphens included.
	expect(parseTarget('some-server')).toStrictEqual({ kind: 'invite', value: 'some-server' });
});

test('a snowflake wins over the invite reading', () => {
	// Eighteen digits is a syntactically valid vanity code, so this is a real ambiguity -- resolved towards the
	// overwhelmingly more likely intent rather than left to chance.
	expect(parseTarget('1425493115053019319')?.kind).toBe('guild');
	// ...but only when it is the whole input. Inside a link it is still a code.
	expect(parseTarget('discord.gg/1425493115053019319')).toStrictEqual({
		kind: 'invite',
		value: '1425493115053019319',
	});
});

test('junk is rejected rather than guessed at', () => {
	expect(parseTarget('')).toBeNull();
	expect(parseTarget('   ')).toBeNull();
	expect(parseTarget('why was I banned from this server')).toBeNull();
	expect(parseTarget('https://discord.gg/')).toBeNull();
	// Past Discord's own code length, so nothing that could resolve.
	expect(parseTarget('a'.repeat(65))).toBeNull();
});
