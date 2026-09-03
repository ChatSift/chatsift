/**
 * The AutoModerator hub's sections, grouped -- and the single source the breadcrumb's section dropdown and its
 * segment labels are derived from, so a section can't be added to one and forgotten in the other (#373, #376,
 * #378 were all that gap).
 *
 * Grouped rather than listed flat because AutoModerator has three to five times as many sections as any other
 * bot here, and fifteen equally-weighted rows gave no clue which two you actually open daily. The group order
 * is the order you set the bot up in: what it did, what it catches, what happens when it keeps catching the
 * same person, and where any of that gets written down.
 */
export const AUTOMODERATOR_SECTION_GROUPS = [
	{
		title: 'Moderation',
		sections: [
			{
				segment: 'cases',
				title: 'Cases',
				subtitle: 'Every moderation action taken in this server, and who took it',
			},
			{
				segment: 'reports',
				title: 'Reports',
				subtitle: 'What members have flagged to your staff team',
			},
		],
	},
	{
		title: 'Filters',
		sections: [
			{
				segment: 'banned-words',
				title: 'Banned Words',
				subtitle: "What happens when Discord's AutoMod catches somebody",
			},
			{
				segment: 'url-filter',
				title: 'URL Filter',
				subtitle: 'Which links members are allowed to post',
			},
			{
				segment: 'invite-filter',
				title: 'Invite Filter',
				subtitle: 'Which other servers members are allowed to link',
			},
			{
				segment: 'anti-spam',
				title: 'Anti-Spam',
				subtitle: 'How many messages, how quickly, before it counts as spam',
			},
			{
				segment: 'exemptions',
				title: 'Exemptions',
				subtitle: 'Channels the filters skip, and roles they never punish',
			},
		],
	},
	{
		title: 'Escalation',
		sections: [
			{
				segment: 'warn-ladder',
				title: 'Warn Ladder',
				subtitle: 'What happens as warnings pile up, and when they stop counting',
			},
			{
				segment: 'filter-ladder',
				title: 'Filter Ladder',
				subtitle: 'What happens as filter triggers pile up, and when they stop counting',
			},
		],
	},
	{
		title: 'Logging & reporting',
		sections: [
			{
				segment: 'logging',
				title: 'Logging',
				subtitle: 'Where actions, message edits and profile changes are posted, and what is left out',
			},
			{
				segment: 'report-settings',
				title: 'Report Settings',
				subtitle: 'Where reports go, and the reasons reporters can pick from',
			},
			{
				segment: 'report-prompts',
				title: 'Report Prompts',
				subtitle: 'Messages telling members how to report DMs to this server',
			},
		],
	},
] as const;

export const AUTOMODERATOR_SECTIONS = AUTOMODERATOR_SECTION_GROUPS.flatMap((group) =>
	group.sections.map((section) => section.segment),
);

export const AUTOMODERATOR_SECTION_LABELS: Record<string, string> = Object.fromEntries(
	AUTOMODERATOR_SECTION_GROUPS.flatMap((group) => group.sections.map((section) => [section.segment, section.title])),
);
