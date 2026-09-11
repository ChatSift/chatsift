/**
 * Text handling every embed builder in this package needs, extracted once the third one wanted it (#232 P4).
 * `automoderatorCaseEmbeds.ts` and `automoderatorReportEmbeds.ts` each had their own `truncate`, and the
 * appeal card needed both that and the fence neutralizer.
 */

/**
 * Trims to a hard limit, marking that it did. Every Discord text field has one -- 256 for an embed field name,
 * 1024 for its value, 4096 for a description -- and going over is a 400 on the whole message rather than a
 * clipped field.
 */
export function truncate(value: string, limit: number): string {
	return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

/**
 * Neutralizes a code fence inside text somebody else wrote.
 *
 * The content is whatever the user typed. A literal triple-backtick in it closes the block early and the rest
 * renders as markdown *in the bot's own embed* -- which is a spoofing vector, not just a layout glitch:
 * attacker text can be dressed up as something the bot said, a fake "verified" link being the obvious use.
 * Zero-width spaces between the backticks stop the fence from closing while leaving the text readable.
 *
 * **Whole runs, not exact triples.** This replaced ``` with `<zws>`` until 2026-09-11, which leaves a seam:
 * four backticks neutralize to `<zws>``` and six to `<zws>```<zws>``, both of which contain a working fence
 * again -- so the escape was defeated by holding the key down. Splitting the entire run guarantees no two
 * backticks are left adjacent, which is the property that actually matters.
 */
export function fence(value: string): string {
	return value.replaceAll(/`{3,}/g, (run) => [...run].join('\u200B'));
}
