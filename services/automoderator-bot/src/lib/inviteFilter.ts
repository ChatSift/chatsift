import { getContext } from '@chatsift/backend-core';
import { extractInviteCodes } from '@chatsift/core';
import type { AutomoderatorAllowedInvites } from '@chatsift/db';

/**
 * The invite filter (P5b, feature 03): invites to servers the guild has not allowlisted.
 *
 * **Allowlisted by resolved guild id, never by code.** A server has any number of invite codes, can mint more
 * at will, and its vanity URL is a third spelling of the same destination -- so a code-keyed allowlist allows
 * one link rather than one server. Legacy learned that in 2021 and fixed it the same way; the port keeps the
 * fix and drops the Cloudflare worker legacy resolved through, which is live but sourceless and unreferenced.
 * The bot's own REST client does the job.
 */

/**
 * How long a resolved code is trusted for.
 *
 * Short, and the reason is the failure mode rather than the cost: an invite that gets *revoked* keeps
 * resolving from cache until this expires, so the window is set to the length of a raid rather than the length
 * of a config screen's attention span. Long enough that a link pasted forty times in a minute costs one
 * request, which is the case that matters.
 */
const INVITE_CACHE_TTL_MS = 60 * 1_000;

interface CachedInvite {
	readonly expiresAt: number;
	/**
	 * The guild the code points at, or `null` for a code that resolved to nothing -- an expired invite, a typo,
	 * or a group DM. Cached either way, deliberately: a raid pasting dead links would otherwise issue one
	 * request per message forever to be told no every time.
	 */
	readonly guildId: string | null;
}

/**
 * Process-local rather than redis, matching `automodRules.ts`: this is a request-saving nicety measured in
 * bytes, it regenerates on any miss, and a replica holding its own copy is strictly better than a network
 * round trip to share one.
 */
const cache = new Map<string, CachedInvite>();

/**
 * Exported for the tests, and for `/simulate` to force a fresh resolution when somebody is debugging why a
 * link did or did not trip the filter.
 */
export function clearInviteCache(): void {
	cache.clear();
}

async function resolveInviteGuild(code: string): Promise<string | null> {
	const cached = cache.get(code);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.guildId;
	}

	let guildId: string | null = null;

	try {
		const invite = await getContext().service.client.api.invites.get(code);
		// A group-DM invite carries no guild, and there is nothing for the filter to compare.
		guildId = invite.guild?.id ?? null;
	} catch (error) {
		// Every failure resolves to "unknown", which fails the filter **open**: a code we cannot read is not
		// deleted. The other direction would let a Discord outage delete every message containing an invite,
		// which is the irreversible one.
		getContext().logger.debug({ err: error, code }, 'could not resolve an invite code');
	}

	cache.set(code, { guildId, expiresAt: Date.now() + INVITE_CACHE_TTL_MS });
	return guildId;
}

async function listAllowedGuildIds(guildId: string): Promise<Set<string>> {
	const rows = await getContext().db<Pick<AutomoderatorAllowedInvites, 'allowedGuildId'>[]>`
		SELECT allowed_guild_id FROM automoderator_allowed_invites WHERE guild_id = ${guildId}
	`;

	// `.toString()` because kanel brands primary-key columns.
	return new Set(rows.map((row) => row.allowedGuildId.toString()));
}

export interface InviteFilterHit {
	/**
	 * The codes that are not allowed, in the order they appeared. Never empty -- see `UrlFilterHit`.
	 */
	readonly forbidden: string[];
}

/**
 * Runs the invite filter over a message's content, or returns `null` if nothing in it is forbidden.
 *
 * **A guild's own invites are always allowed**, without a row saying so. Legacy required a server to allowlist
 * itself, which every server had to do and none of them expected to -- an invite to the server you are already
 * in is not an advertisement for a different one. It is also the only entry that could never be added through
 * the dashboard's normal flow at the moment somebody has just turned the filter on and posted their own link
 * to test it.
 */
export async function runInviteFilter(guildId: string, content: string): Promise<InviteFilterHit | null> {
	const codes = extractInviteCodes(content);
	if (codes.length === 0) {
		return null;
	}

	const allowlist = await listAllowedGuildIds(guildId);
	// Resolved together rather than in sequence: a message carrying five invites is a raid, and five serial
	// round trips is how the filter arrives after the damage.
	const resolved = await Promise.all(codes.map(async (code) => ({ code, target: await resolveInviteGuild(code) })));

	const forbidden = resolved
		.filter(({ target }) => target !== null && target !== guildId && !allowlist.has(target))
		.map(({ code }) => code);

	return forbidden.length > 0 ? { forbidden } : null;
}
