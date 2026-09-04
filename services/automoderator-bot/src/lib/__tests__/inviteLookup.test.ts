import type { APIInvite, APIInviteGuild } from '@discordjs/core';
import { GuildVerificationLevel } from '@discordjs/core';
import { expect, test } from 'vitest';
import type { InviteWithGuild } from '../inviteLookup.js';
import { buildInviteLookupEmbed, hasGuild } from '../inviteLookup.js';

function guild(overrides: Partial<APIInviteGuild> = {}): APIInviteGuild {
	return {
		id: '167_000_000_000_000_000'.replaceAll('_', ''),
		name: 'Example',
		splash: null,
		banner: null,
		description: null,
		icon: null,
		features: [],
		verification_level: GuildVerificationLevel.Medium,
		vanity_url_code: null,
		nsfw_level: 0,
		premium_subscription_count: 0,
		...overrides,
	} as APIInviteGuild;
}

function invite(overrides: Partial<APIInvite> = {}): InviteWithGuild {
	return {
		code: 'abc',
		guild: guild(),
		channel: { id: '2', name: 'general', type: 0 },
		expires_at: null,
		...overrides,
	} as InviteWithGuild;
}

test('a group DM invite is not a server', () => {
	expect(hasGuild({ code: 'abc', channel: null, expires_at: null } as APIInvite)).toBe(false);
	expect(hasGuild(invite())).toBe(true);
});

test('the verification level is named rather than numbered', () => {
	const embed = buildInviteLookupEmbed(invite());
	expect(embed.fields?.find((field) => field.name === 'Verification')?.value).toContain('Medium');
});

// Every one of these is optional on the payload, and an embed with an empty field value is an embed Discord
// rejects outright -- so the absent cases have to be absent fields, not blank ones.
test('counts, vanity url and features are omitted when the invite carries none', () => {
	const embed = buildInviteLookupEmbed(invite());
	const names = embed.fields?.map((field) => field.name);

	expect(names).not.toContain('Members');
	expect(names).not.toContain('Vanity URL');
	expect(names).not.toContain('Features');
	expect(embed.description).toBeUndefined();
	expect(embed.image).toBeUndefined();
});

test('counts are shown when the fetch asked for them', () => {
	const embed = buildInviteLookupEmbed(invite({ approximate_member_count: 4_200, approximate_presence_count: 350 }));

	expect(embed.fields?.find((field) => field.name === 'Members')?.value).toBe('4200\n350 online');
});

test('a long feature list is cut off and says so', () => {
	const features = Array.from({ length: 20 }, (_, index) => `FEATURE_${index}`);
	const embed = buildInviteLookupEmbed(invite({ guild: guild({ features: features as APIInviteGuild['features'] }) }));

	expect(embed.fields?.find((field) => field.name === 'Features')?.value).toContain('and 8 more');
});

test('an invite with no expiry says so rather than leaving it out', () => {
	expect(buildInviteLookupEmbed(invite()).fields?.find((field) => field.name === 'Invite')?.value).toContain(
		'Expires: never',
	);
});

test('the icon and banner become urls only when the guild has them', () => {
	const decorated = buildInviteLookupEmbed(
		invite({ guild: guild({ icon: 'iconhash', banner: 'bannerhash', description: 'A server' }) }),
	);

	expect(decorated.author?.icon_url).toContain('/icons/');
	expect(decorated.image?.url).toContain('/banners/');
	expect(decorated.description).toBe('A server');
});
