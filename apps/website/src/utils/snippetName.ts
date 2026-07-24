/**
 * A snippet's name becomes its own Discord slash command name (e.g. a snippet named `reportuser` is
 * invoked as `/reportuser`), so it's bound by Discord's command-name rules -- lowercase, no spaces,
 * 1-32 characters, letters/numbers/hyphen/underscore only. Best-effort client-side auto-correct
 * towards that shape; Discord's own validation (surfaced as a 422 from the API) is still the final
 * authority for anything unusual this doesn't catch.
 */
export function normalizeSnippetName(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replaceAll(/\s+/g, '-')
		.replaceAll(/[^\p{L}\p{N}_-]/gu, '')
		.slice(0, 32);
}
