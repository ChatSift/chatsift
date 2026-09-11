/**
 * The ModMail hub's sections, and the single source the breadcrumb's section dropdown, its segment labels and
 * the jump-to palette are derived from -- the same arrangement `appealsSections.ts` uses, for the reason its
 * own comment gives. Lifted out of the hub page, where the palette could not reach it.
 */
export const MODMAIL_SECTION_LIST = [
	{
		segment: 'config',
		title: 'Config',
		subtitle: 'Mod forum, greeting/farewell messages, and alert role',
	},
	{
		segment: 'categories',
		title: 'Categories',
		subtitle: 'Categories users pick when opening a ticket',
	},
	{
		segment: 'panels',
		title: 'Panels',
		subtitle: 'Ticket-creation panels posted in your server',
	},
	{
		segment: 'snippets',
		title: 'Snippets',
		subtitle: 'Quick canned responses staff can use in a ticket',
	},
	{
		segment: 'blocks',
		title: 'Blocks',
		subtitle: 'Users blocked from opening new tickets',
	},
	{
		segment: 'threads',
		title: 'Threads',
		subtitle: 'Browse past and open threads',
	},
] as const;

export const MODMAIL_SECTIONS = MODMAIL_SECTION_LIST.map((section) => section.segment);

export const MODMAIL_SECTION_LABELS: Record<string, string> = Object.fromEntries(
	MODMAIL_SECTION_LIST.map((section) => [section.segment, section.title]),
);
