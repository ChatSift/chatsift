import type { WsTicketData } from '@chatsift/backend-core';
import { amaPublicAnswersChannel, amaQuestionsChannel, socialLeaderboardChannel } from '@chatsift/core';
import { expect, test } from 'vitest';
import { isAuthorizedForChannel } from '../authorizeChannel.js';

const GUILD = '1425493115053019319';
const OTHER_GUILD = '1530909114736050316';

function ticket(overrides: Partial<WsTicketData> = {}): WsTicketData {
	return {
		kind: 'ws',
		sub: '123',
		iat: 0,
		adminGuilds: [],
		channels: [],
		isAdmin: false,
		...overrides,
	};
}

test('a manager of the guild gets every channel under it', () => {
	const manager = ticket({ adminGuilds: [GUILD] });

	expect(isAuthorizedForChannel(manager, amaQuestionsChannel(GUILD, 1))).toBe(true);
	expect(isAuthorizedForChannel(manager, amaQuestionsChannel(GUILD, 99))).toBe(true);
});

test('a manager of one guild gets nothing under another', () => {
	const manager = ticket({ adminGuilds: [GUILD] });

	expect(isAuthorizedForChannel(manager, amaQuestionsChannel(OTHER_GUILD, 1))).toBe(false);
});

test('a global admin gets every guild-scoped channel', () => {
	const admin = ticket({ isAdmin: true });

	expect(isAuthorizedForChannel(admin, amaQuestionsChannel(GUILD, 1))).toBe(true);
	expect(isAuthorizedForChannel(admin, amaQuestionsChannel(OTHER_GUILD, 1))).toBe(true);
});

test('an AMA guest gets exactly the sessions listed on their ticket', () => {
	// The #323 case: no `adminGuilds` entry at all (guest access isn't a `meCanManage` grant), so the
	// allowlist is the only thing letting them through.
	const guest = ticket({ channels: [amaQuestionsChannel(GUILD, 1)] });

	expect(isAuthorizedForChannel(guest, amaQuestionsChannel(GUILD, 1))).toBe(true);
});

test('an AMA guest is rejected for another AMA in the same guild', () => {
	const guest = ticket({ channels: [amaQuestionsChannel(GUILD, 1)] });

	expect(isAuthorizedForChannel(guest, amaQuestionsChannel(GUILD, 2))).toBe(false);
});

test('a public answers ticket is confined to its one channel', () => {
	const publicTicket = ticket({ sub: 'public:1', channels: [amaPublicAnswersChannel(1)] });

	expect(isAuthorizedForChannel(publicTicket, amaPublicAnswersChannel(1))).toBe(true);
	expect(isAuthorizedForChannel(publicTicket, amaPublicAnswersChannel(2))).toBe(false);
	expect(isAuthorizedForChannel(publicTicket, amaQuestionsChannel(GUILD, 1))).toBe(false);
});

test('the guildless public domain is never reachable via the guild path', () => {
	// `ama-public:<amaId>` has no guild segment, so a naive `split(':')[1]` would read the ama id as one --
	// a manager whose `adminGuilds` happened to contain a matching string must still not match, and a global
	// admin must not inherit it either.
	expect(isAuthorizedForChannel(ticket({ adminGuilds: ['1'] }), amaPublicAnswersChannel(1))).toBe(false);
	expect(isAuthorizedForChannel(ticket({ isAdmin: true }), amaPublicAnswersChannel(1))).toBe(false);
});

test('a public leaderboard ticket reaches its own guild channel and nothing else under that guild', () => {
	// Unlike AMA's public page, this channel *is* guild-shaped, so the allowlist is doing load-bearing work
	// rather than just naming a guildless string: an empty `adminGuilds` is what stops this ticket from
	// walking the guild-wide path into every other Social channel in the same guild.
	const publicTicket = ticket({
		sub: `public-leaderboard:${GUILD}`,
		channels: [socialLeaderboardChannel(GUILD)],
	});

	expect(isAuthorizedForChannel(publicTicket, socialLeaderboardChannel(GUILD))).toBe(true);
	expect(isAuthorizedForChannel(publicTicket, socialLeaderboardChannel(OTHER_GUILD))).toBe(false);
	expect(isAuthorizedForChannel(publicTicket, amaQuestionsChannel(GUILD, 1))).toBe(false);
	expect(isAuthorizedForChannel(publicTicket, `social:${GUILD}:anything-else`)).toBe(false);
});

test('a manager of the guild reaches its leaderboard without it being listed', () => {
	// The other half of the same channel: the dashboard subscribes to the identical string through the
	// guild-wide grant, which is why there is only one channel here rather than a public twin.
	expect(isAuthorizedForChannel(ticket({ adminGuilds: [GUILD] }), socialLeaderboardChannel(GUILD))).toBe(true);
	expect(isAuthorizedForChannel(ticket({ adminGuilds: [OTHER_GUILD] }), socialLeaderboardChannel(GUILD))).toBe(false);
});

test('rejects a malformed channel', () => {
	const admin = ticket({ isAdmin: true });

	expect(isAuthorizedForChannel(admin, 'ama-questions')).toBe(false);
	expect(isAuthorizedForChannel(admin, 'ama-questions:')).toBe(false);
	expect(isAuthorizedForChannel(admin, `ama-questions:${GUILD}`)).toBe(false);
	expect(isAuthorizedForChannel(admin, `ama-questions::1`)).toBe(false);
});
