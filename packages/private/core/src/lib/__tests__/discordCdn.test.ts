import { expect, test } from 'vitest';
import { displayAvatarURL, userAvatarURL } from '../discordCdn.js';

const USER_ID = '223703707118731264';

test('builds a user avatar url, and says so when there is none', () => {
	expect(userAvatarURL(USER_ID, 'abc123')).toBe(`https://cdn.discordapp.com/avatars/${USER_ID}/abc123.png`);
	expect(userAvatarURL(USER_ID, null)).toBeNull();
	expect(userAvatarURL(USER_ID, undefined)).toBeNull();
});

// #377: an embed author line is never half-illustrated, so a member who never set an avatar still gets the
// picture Discord's own client draws for them.
test('falls back to the default avatar Discord itself would draw', () => {
	expect(displayAvatarURL(USER_ID, 'abc123')).toBe(`https://cdn.discordapp.com/avatars/${USER_ID}/abc123.png`);

	// (id >> 22) % 6, the post-pomelo index.
	const index = Number((BigInt(USER_ID) >> 22n) % 6n);
	expect(displayAvatarURL(USER_ID, null)).toBe(`https://cdn.discordapp.com/embed/avatars/${index}.png`);
});

// These run inside embed builders, where an id that isn't a snowflake must not throw the whole log entry away.
test('does not throw on an id that is not a snowflake', () => {
	expect(displayAvatarURL('not-an-id', null)).toBe('https://cdn.discordapp.com/embed/avatars/0.png');
});
