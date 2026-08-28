/**
 * The URL and invite filters' matching rules (P5b, features 02 and 03).
 *
 * Here rather than in `automoderator-bot` because three consumers have to agree on them exactly: the bot runs
 * them against every message, `services/api` normalises an allowlist entry with the same functions before
 * storing it, and `apps/website` shows the guild what its entry will actually be saved as. The same reasoning
 * that put duration parsing in one place at P5a -- a normaliser and a matcher that disagree by one rule produce
 * an allowlist row that looks right in the dashboard and never matches anything at runtime.
 *
 * No dependencies beyond the language: `apps/website` imports this into the browser.
 */

/**
 * Links, **scheme-required**. `https://evil.com/x` matches; a bare `evil.com` does not.
 *
 * That is legacy's rule, kept deliberately after being reconsidered at P5b. Requiring the scheme is what makes
 * the filter safe to run over ordinary prose with no TLD list at all: "I rewrote it in node.js", "nice,
 * thanks.lol" and a version number all read as links to a schemeless matcher, and the IANA list legacy fetched
 * at Docker build time only ever existed to paper over that. The cost is stated plainly rather than hidden --
 * a member who drops the scheme is not caught, and the invite filter below is schemeless precisely because
 * `discord.gg` needs no such hedging.
 *
 * Captures the whole **authority** -- userinfo, host and port together -- and leaves the splitting to
 * {@link normalizeHost}. Everything from the first `/`, `?` or `#` onward is outside the match, so a domain in a
 * path or query string cannot smuggle one past the allowlist.
 *
 * The authority is taken whole rather than just the host because the two halves have to agree about where
 * userinfo ends, and a capture that stops at the first `:` cannot: `https://allowed.example:pw@evil.example`
 * would be checked against `allowed.example` while the browser goes to `evil.example`. Splitting in one place
 * is what makes that unrepresentable.
 */
const URL_PATTERN = /https?:\/\/(?<authority>[^\s#/?]+)/gi;

/**
 * Discord invites, **scheme-optional**. `discord.gg/x`, `www.discord.com/invite/x` and the full https form all
 * match, which is what legacy did and is safe here for the reason the URL matcher is not: the literal
 * `discord.gg` / `discord.com/invite` prefix is not something anybody writes by accident.
 *
 * The leading `(?:^|[^\w.-])` is a left boundary, so `evildiscord.gg/x` and `notadiscord.com/invite/x` are not
 * read as invites -- without it they resolve a code that was never a Discord invite, and delete a message on the
 * strength of it. It **consumes** the preceding character rather than using a lookbehind: only the named group
 * is ever read, and this file is bundled into the browser, where a lookbehind is a parse error rather than a
 * runtime one on anything old enough to lack it.
 */
const INVITE_PATTERN =
	/(?:^|[^\w.-])(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/(?<code>[\w-]{2,})/gi;

/**
 * The host out of a URL authority: userinfo and port removed, case folded, and any trailing punctuation the
 * match swept up discarded. Returns `null` for anything that cannot be a domain, which is what keeps `https://`
 * on its own (or a userinfo-only URL) out of the allowlist and out of a match.
 *
 * Not a public-suffix reduction, deliberately -- see {@link findAllowedDomain}.
 */
function normalizeHost(authority: string): string | null {
	// A `user:pass@host` URL is legal and Discord renders it as a link, so the host is what follows the *last*
	// `@` -- taking what precedes it would match the allowlist against a string the browser never visits.
	const afterUserInfo = authority.slice(authority.lastIndexOf('@') + 1);
	// A port is not part of the host at all.
	const withoutPort = afterUserInfo.split(':')[0] ?? '';

	// A hostname ends in an alphanumeric, so anything trailing that isn't one belongs to the sentence rather
	// than to the link: `https://example.com,` and `(https://example.com)` are both `example.com`. Dropping only
	// the trailing dot -- the fully-qualified spelling -- left `example.com,` as its own host, which matches no
	// allowlist entry and so deleted a message whose link was explicitly allowed.
	const bare = withoutPort.toLowerCase().replace(/[^\da-z]+$/, '');

	return bare.length > 0 ? bare : null;
}

/**
 * Every distinct host linked to in a message, in the order they first appear.
 *
 * Order is preserved rather than sorted because the filter log names what it matched and a moderator reading
 * it is looking at the message alongside it.
 */
export function extractLinkedHosts(content: string): string[] {
	const hosts: string[] = [];
	const seen = new Set<string>();

	for (const match of content.matchAll(URL_PATTERN)) {
		const host = normalizeHost(match.groups?.['authority'] ?? '');

		if (host !== null && !seen.has(host)) {
			seen.add(host);
			hosts.push(host);
		}
	}

	return hosts;
}

/**
 * Every distinct invite code in a message, in the order they first appear. Codes keep their case -- Discord's
 * are case-sensitive, and a lowercased one resolves to nothing.
 */
export function extractInviteCodes(content: string): string[] {
	const codes: string[] = [];
	const seen = new Set<string>();

	for (const match of content.matchAll(INVITE_PATTERN)) {
		const code = match.groups?.['code'];

		if (code !== undefined && !seen.has(code)) {
			seen.add(code);
			codes.push(code);
		}
	}

	return codes;
}

/**
 * Turns whatever a guild pasted into the allowlist field into the host it means, or `null` if it means nothing.
 *
 * Accepts a bare domain, a full URL, and the half-typed forms in between (`https://example.com/some/page`,
 * `example.com/`, `EXAMPLE.com.`). The API stores what this returns, so what the guild sees in the list is
 * exactly what the matcher will compare against.
 *
 * Rejects anything with no dot in it: a single label is either a typo or an intranet name, and storing one
 * would allowlist a suffix that can never be reached from Discord anyway. It also rejects a lone TLD --
 * `.com` -- for a much more pointed reason, given the suffix matching below: `com` as an entry would allow
 * every `.com` domain there is, which nobody types on purpose.
 */
export function normalizeAllowedDomain(input: string): string | null {
	const trimmed = input.trim();
	if (trimmed.length === 0) {
		return null;
	}

	// The path, query and fragment are all dropped -- the allowlist is per-domain and a path in an entry would
	// silently never match. `//` handles a protocol-relative paste.
	const withoutScheme = trimmed.replace(/^[a-z][\w+.-]*:\/\//i, '').replace(/^\/\//, '');
	const host = normalizeHost(withoutScheme.split(/[#/?]/)[0] ?? '');

	if (host === null) {
		return null;
	}

	const labels = host.split('.');

	// Every label has to be non-empty (`example..com` and `.example.com` are both malformed), and there has to
	// be more than one of them.
	if (labels.length < 2 || labels.some((label) => label.length === 0)) {
		return null;
	}

	return host;
}

/**
 * The allowlist entry covering `host`, or `null` if none does.
 *
 * **Suffix matching on label boundaries:** `example.com` covers `example.com` and `cdn.example.com`, and does
 * not cover `notexample.com`. That is what a guild allowlisting a site means, and it is right for
 * `example.co.uk` without needing a public-suffix list to know that `co.uk` is not a registrable domain.
 *
 * Legacy instead reduced both sides to their last two labels before comparing, which got `example.co.uk` wrong
 * in both directions at once -- the site could not be allowlisted, and allowlisting the reduction would have
 * opened every `.co.uk` domain there is.
 *
 * Returns the entry rather than a boolean so the decision trace and `/simulate` can name *which* row let a link
 * through, which is the question a moderator asks when one does.
 */
export function findAllowedDomain(host: string, allowlist: Iterable<string>): string | null {
	for (const entry of allowlist) {
		if (host === entry || host.endsWith(`.${entry}`)) {
			return entry;
		}
	}

	return null;
}
