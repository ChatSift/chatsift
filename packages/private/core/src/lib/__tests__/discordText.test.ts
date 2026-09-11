import { expect, test } from 'vitest';
import { fence, truncate } from '../discordText.js';

test('truncate leaves a short string alone and marks a long one', () => {
	expect(truncate('short', 10)).toBe('short');
	expect(truncate('exactly-10', 10)).toBe('exactly-10');
	expect(truncate('far too long', 10)).toBe('far too l…');
	expect(truncate('far too long', 10)).toHaveLength(10);
});

test('fence neutralizes a code fence', () => {
	expect(fence('```')).not.toContain('```');
	expect(fence('hello ``` world')).not.toContain('```');
});

test('fence survives runs longer than three, which is how the old version was defeated', () => {
	// Replacing exact triples left a seam: four backticks became `<zws>``` and six became `<zws>```<zws>``,
	// each containing a working fence again -- so the escape was beaten by holding the key down. Anything that
	// reintroduces an exact-triple replacement fails here.
	for (let length = 3; length <= 24; length++) {
		expect(fence('`'.repeat(length))).not.toContain('```');
	}

	expect(fence('a ```` b ``````` c')).not.toContain('```');
});

test('fence leaves text that cannot close a fence untouched', () => {
	// Inline code and a stray pair are not a fence, and mangling them would cost readability for nothing.
	for (const value of ['no backticks at all', '`inline`', 'a `` b', '`` ``']) {
		expect(fence(value)).toBe(value);
	}
});
