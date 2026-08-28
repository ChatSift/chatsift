import { getContext } from '@chatsift/backend-core';
import { extractLinkedHosts, findAllowedDomain } from '@chatsift/core';
import type { AutomoderatorAllowedUrls } from '@chatsift/db';

/**
 * The URL filter (P5b, feature 02): links to anywhere the guild has not allowlisted.
 *
 * The matching itself lives in `@chatsift/core` so `services/api` normalises an allowlist entry with the same
 * rules this compares against -- see `automoderatorFilters.ts` there for the scheme-required decision and the
 * suffix matching that replaced legacy's last-two-labels reduction.
 *
 * This module is the half that touches the database: read the guild's allowlist, and say which of a message's
 * hosts survive it.
 */

export interface UrlFilterHit {
	/**
	 * The hosts that are *not* allowed, in the order they appeared. Never empty -- a message with nothing
	 * forbidden produces `null` instead, so a caller cannot mistake an empty list for a hit.
	 */
	readonly forbidden: string[];
}

async function listAllowedDomains(guildId: string): Promise<string[]> {
	const rows = await getContext().db<Pick<AutomoderatorAllowedUrls, 'domain'>[]>`
		SELECT domain FROM automoderator_allowed_urls WHERE guild_id = ${guildId}
	`;

	// `.toString()` because kanel brands primary-key columns.
	return rows.map((row) => row.domain.toString());
}

/**
 * Runs the URL filter over a message's content, or returns `null` if nothing in it is forbidden.
 *
 * Bounded on purpose: an empty allowlist means every link is forbidden, which is a coherent and strict
 * configuration ("no links at all") rather than an unconfigured one -- the guild had to turn `useUrlFilters` on
 * to reach here at all, and that is the flag that says which they meant.
 */
export async function runUrlFilter(guildId: string, content: string): Promise<UrlFilterHit | null> {
	const hosts = extractLinkedHosts(content);
	if (hosts.length === 0) {
		return null;
	}

	const allowlist = await listAllowedDomains(guildId);
	const forbidden = hosts.filter((host) => findAllowedDomain(host, allowlist) === null);

	return forbidden.length > 0 ? { forbidden } : null;
}
