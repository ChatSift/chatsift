/**
 * The Appeals hub's sections, and the single source the breadcrumb's section dropdown and its segment labels
 * are derived from -- the same arrangement `automoderatorSections.ts` uses, for the reason its own comment
 * gives: a section added to the hub and forgotten in the breadcrumb reaches the URL bar as its raw kebab-case
 * segment.
 *
 * Flat rather than grouped: three sections need no grouping.
 */
export const APPEALS_SECTION_LIST = [
	{
		// First, and deliberately: this is the section somebody opens Appeals to use, while the other two are set
		// once and left alone.
		segment: 'queue',
		title: 'Queue',
		subtitle: 'Every appeal filed in this server, and the decision on it',
	},
	{
		segment: 'config',
		title: 'Config',
		subtitle: 'Where appeals are posted, how often somebody may appeal, and what approval does',
	},
	{
		segment: 'unappealable-users',
		title: 'Unappealable Users',
		subtitle: 'Accounts that may never appeal a ban in this server',
	},
] as const;

export const APPEALS_SECTIONS = APPEALS_SECTION_LIST.map((section) => section.segment);

export const APPEALS_SECTION_LABELS: Record<string, string> = Object.fromEntries(
	APPEALS_SECTION_LIST.map((section) => [section.segment, section.title]),
);
