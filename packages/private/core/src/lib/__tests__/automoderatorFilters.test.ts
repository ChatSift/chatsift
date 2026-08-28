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

test('extractLinkedHosts ignores anything past the host', () => {
	// A domain in the path or query must not be mistaken for the destination.
	expect(extractLinkedHosts('https://evil.com/?to=allowed.com')).toEqual(['evil.com']);
	expect(extractLinkedHosts('https://evil.com/allowed.com')).toEqual(['evil.com']);
});

test('extractInviteCodes accepts every spelling of an invite', () => {
	expect(extractInviteCodes('https://discord.gg/abc123')).toEqual(['abc123']);
	expect(extractInviteCodes('discord.gg/abc123')).toEqual(['abc123']);
	expect(extractInviteCodes('www.discord.com/invite/abc123')).toEqual(['abc123']);
	expect(extractInviteCodes('http://discordapp.com/invite/abc123')).toEqual(['abc123']);
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
