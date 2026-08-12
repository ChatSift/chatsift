/**
 * Placeholder substitution for dashboard-authored strings a bot renders back into Discord -- ModMail's
 * greetings/farewells and anon-reply labels, Social's level-up notifications and interaction content.
 *
 * One implementation shared by both, so the syntax a guild learns in one product is the syntax that works in the
 * other. Whitespace around the name is tolerated (`{{name}}`, `{{ name }}` and `{{  name  }}` are all the same
 * placeholder) -- ModMail widened it that way to keep configs authored under older hint text resolving, and
 * Social follows rather than keeping its own stricter variant.
 *
 * An unknown placeholder renders as `[unknown template foo]` instead of throwing: these run on hot paths where
 * the alternative is a message that never sends.
 */
export function templateString<TData extends object>(content: string, data: TData): string {
	const values = data as Record<string, string | undefined>;

	return content.replaceAll(/{{\s*(?<template>\w+?)\s*}}/gm, (_, template: string) => {
		// `Object.hasOwn` rather than a bare lookup: without it, `{{ constructor }}` (or `{{ toString }}`) reaches
		// `Object.prototype`, and since a function isn't nullish the `??` below would let it through and stringify
		// it into the rendered message. An own key that's explicitly `undefined` still falls through to the
		// marker, which is what an optional field on a template-data interface should do.
		const value = Object.hasOwn(values, template) ? values[template] : undefined;

		return value ?? `[unknown template ${template}]`;
	});
}
