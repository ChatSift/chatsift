import { expect, test } from 'vitest';
import {
	extractInviteCodes,
	extractLinkedHosts,
	findAllowedDomain,
	normalizeAllowedDomain,
} from '../automoderatorFilters.js';

test('extractLinkedHosts requires a scheme', () => {
	expect(extractLinkedHosts('https://evil.com/join')).toEqual(['evil.com']);
	expect(extractLinkedHosts('http://evil.com')).toEqual(['evil.com']);

	// The whole reason this filter needs no TLD list: prose that ends in a real TLD is not a link.
	expect(extractLinkedHosts('nice, thanks.lol')).toEqual([]);
	expect(extractLinkedHosts('I rewrote it in node.js')).toEqual([]);
	expect(extractLinkedHosts('check evil.com')).toEqual([]);
});

test('extractLinkedHosts normalizes and dedupes hosts', () => {
	expect(extractLinkedHosts('https://EVIL.com/a and https://evil.com/b')).toEqual(['evil.com']);
	expect(extractLinkedHosts('https://evil.com:8080/x')).toEqual(['evil.com']);
	// The fully-qualified spelling is the same host.
	expect(extractLinkedHosts('https://evil.com./x')).toEqual(['evil.com']);
	expect(extractLinkedHosts('https://a.com https://b.com https://a.com')).toEqual(['a.com', 'b.com']);
});

test('extractLinkedHosts reads the host after userinfo', () => {
	// `https://good.com@evil.com/` goes to evil.com. Matching the allowlist against `good.com` here would let
	// the link straight through.
	expect(extractLinkedHosts('https://good.com@evil.com/x')).toEqual(['evil.com']);
});

// The filter bypass this pattern shipped with, caught in review: the capture used to stop at the first `:`, so
// userinfo *with a password* never reached the `@`-splitting in `normalizeHost` and the allowlisted-looking
// half won. The browser goes to evil.com in every one of these.
test('extractLinkedHosts is not fooled by a password in the userinfo', () => {
	expect(extractLinkedHosts('https://youtube.com:pw@evil.com/x')).toEqual(['evil.com']);
	expect(extractLinkedHosts('https://allowed.example:pass@blocked.example/')).toEqual(['blocked.example']);
	expect(extractLinkedHosts('https://user:pass@evil.com:8080/x')).toEqual(['evil.com']);
});

// The mirror-image bug, found while fixing the one above: trailing punctuation used to stay glued to the host,
// so `example.com,` matched no allowlist entry and a message whose link was explicitly allowed got deleted.
test('extractLinkedHosts drops the punctuation around a link', () => {
	expect(extractLinkedHosts('see https://example.com, it is great')).toEqual(['example.com']);
	expect(extractLinkedHosts('(https://example.com)')).toEqual(['example.com']);
	expect(extractLinkedHosts('https://example.com.')).toEqual(['example.com']);
	expect(extractLinkedHosts('**https://example.com**')).toEqual(['example.com']);
});

test('extractLinkedHosts ignores anything past the host', () => {
	// A domain in the path or query must not be mistaken for the destination.
	expect(extractLinkedHosts('https://evil.com/?to=allowed.com')).toEqual(['evil.com']);
	expect(extractLinkedHosts('https://evil.com/allowed.com')).toEqual(['evil.com']);
});

// The two filters split the work, and this is the seam: an invite is the invite filter's to judge, so the URL
// filter must not delete one that filter had just allowed -- this server's own included, which it allows
// without a row.
test('extractLinkedHosts leaves invites to the invite filter', () => {
	expect(extractLinkedHosts('https://discord.gg/abc')).toEqual([]);
	expect(extractLinkedHosts('join discord.gg/abc')).toEqual([]);
	expect(extractLinkedHosts('https://discord.com/invite/abc')).toEqual([]);
	expect(extractLinkedHosts('https://www.discord.com/invite/abc')).toEqual([]);
	expect(extractLinkedHosts('[join us](https://discord.gg/abc)')).toEqual([]);
});

// Skipped per match, not per host: only the invite itself belongs to the other filter.
test('extractLinkedHosts still reads discord links that are not invites', () => {
	expect(extractLinkedHosts('https://discord.com/channels/1/2')).toEqual(['discord.com']);
	expect(extractLinkedHosts('https://discord.com/invite/abc https://discord.com/channels/1/2')).toEqual([
		'discord.com',
	]);
	// Not an invite to the matcher above, so it stays this filter's business.
	expect(extractLinkedHosts('https://evildiscord.gg/xyz')).toEqual(['evildiscord.gg']);
	expect(extractLinkedHosts('https://evil.com and discord.gg/abc')).toEqual(['evil.com']);
});

test('extractInviteCodes accepts every spelling of an invite', () => {
	expect(extractInviteCodes('https://discord.gg/abc123')).toEqual(['abc123']);
	expect(extractInviteCodes('discord.gg/abc123')).toEqual(['abc123']);
	expect(extractInviteCodes('www.discord.com/invite/abc123')).toEqual(['abc123']);
	expect(extractInviteCodes('http://discordapp.com/invite/abc123')).toEqual(['abc123']);
});

// Without a left boundary these read as invites, spend a REST resolution on a code that was never one, and can
// delete a message on the strength of it.
test('extractInviteCodes does not fire inside a larger hostname', () => {
	expect(extractInviteCodes('evildiscord.gg/xyz')).toEqual([]);
	expect(extractInviteCodes('notadiscord.com/invite/xyz')).toEqual([]);
	// ...while every legitimate spelling still matches, whatever precedes it.
	expect(extractInviteCodes('join discord.gg/abc now')).toEqual(['abc']);
	expect(extractInviteCodes('[discord.gg/abc](discord.gg/def)')).toEqual(['abc', 'def']);
	expect(extractInviteCodes('**discord.gg/abc**')).toEqual(['abc']);
});

test('extractInviteCodes keeps case and dedupes', () => {
	// Discord invite codes are case-sensitive; a lowercased one resolves to nothing.
	expect(extractInviteCodes('discord.gg/AbCdEf')).toEqual(['AbCdEf']);
	expect(extractInviteCodes('discord.gg/one discord.gg/one discord.gg/two')).toEqual(['one', 'two']);
});

test('normalizeAllowedDomain accepts the forms a guild actually pastes', () => {
	expect(normalizeAllowedDomain('example.com')).toBe('example.com');
	expect(normalizeAllowedDomain('  EXAMPLE.com.  ')).toBe('example.com');
	expect(normalizeAllowedDomain('https://example.com/some/page?q=1')).toBe('example.com');
	expect(normalizeAllowedDomain('//example.com/')).toBe('example.com');
	expect(normalizeAllowedDomain('example.com:443')).toBe('example.com');
	expect(normalizeAllowedDomain('sub.example.co.uk')).toBe('sub.example.co.uk');
});

test('normalizeAllowedDomain rejects what could never be an entry', () => {
	expect(normalizeAllowedDomain('')).toBeNull();
	expect(normalizeAllowedDomain('   ')).toBeNull();
	expect(normalizeAllowedDomain('https://')).toBeNull();
	// A single label would allowlist a suffix nothing reachable from Discord ever ends in...
	expect(normalizeAllowedDomain('localhost')).toBeNull();
	// ...and a lone TLD would allowlist every domain under it.
	expect(normalizeAllowedDomain('.com')).toBeNull();
	expect(normalizeAllowedDomain('example..com')).toBeNull();
});

test('findAllowedDomain matches on label boundaries only', () => {
	const allowlist = ['example.com', 'example.co.uk'];

	expect(findAllowedDomain('example.com', allowlist)).toBe('example.com');
	expect(findAllowedDomain('cdn.example.com', allowlist)).toBe('example.com');
	expect(findAllowedDomain('a.b.example.com', allowlist)).toBe('example.com');

	// The bug legacy's last-two-labels reduction had in both directions.
	expect(findAllowedDomain('www.example.co.uk', allowlist)).toBe('example.co.uk');
	expect(findAllowedDomain('someone-else.co.uk', allowlist)).toBeNull();

	expect(findAllowedDomain('notexample.com', allowlist)).toBeNull();
	expect(findAllowedDomain('example.com.evil.net', allowlist)).toBeNull();
});
