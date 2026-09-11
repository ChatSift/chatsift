/**
 * The Social hub's sections, and the single source the breadcrumb's section dropdown, its segment labels and
 * the jump-to palette are derived from -- the same arrangement `appealsSections.ts` uses, for the reason its
 * own comment gives. Lifted out of the hub page, where the palette could not reach it.
 */
export const SOCIAL_SECTION_LIST = [
	{
		segment: 'config',
		title: 'Config',
		subtitle: 'XP gain, the level curve, and level-up notifications',
	},
	{
		segment: 'channels',
		title: 'Channels',
		subtitle: 'Channels that grant no XP, or grant it faster',
	},
	{
		segment: 'roles',
		title: 'Roles',
		subtitle: 'Roles that multiply the XP their holders earn',
	},
	{
		segment: 'rewards',
		title: 'Rewards',
		subtitle: 'Roles handed out when members reach a level',
	},
	{
		segment: 'interactions',
		title: 'Interactions',
		subtitle: 'Custom slash commands like /hug anyone can use',
	},
	{
		segment: 'leaderboard',
		title: 'Leaderboard',
		subtitle: "Leaderboard for your community's most active members, and the public page for it",
	},
] as const;

export const SOCIAL_SECTIONS = SOCIAL_SECTION_LIST.map((section) => section.segment);

export const SOCIAL_SECTION_LABELS: Record<string, string> = Object.fromEntries(
	SOCIAL_SECTION_LIST.map((section) => [section.segment, section.title]),
);
