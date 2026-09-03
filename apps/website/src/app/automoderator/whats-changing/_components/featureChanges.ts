export const FEATURE_OUTCOMES = ['UNCHANGED', 'IMPROVED', 'DIFFERENT', 'RETIRED', 'NEW'] as const;

export type FeatureOutcome = (typeof FEATURE_OUTCOMES)[number];

export const OUTCOME_LABELS: Record<FeatureOutcome, string> = {
	UNCHANGED: 'Unchanged',
	IMPROVED: 'Improved',
	DIFFERENT: 'Different',
	RETIRED: 'Retired',
	NEW: 'New',
};

export const OUTCOME_PILL_CLASSES: Record<FeatureOutcome, string> = {
	UNCHANGED: 'bg-on-tertiary text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark',
	IMPROVED: 'bg-misc-system/10 text-misc-system dark:bg-misc-system-dark/10 dark:text-misc-system-dark',
	DIFFERENT: 'bg-misc-warning/10 text-misc-warning dark:bg-misc-warning-dark/10 dark:text-misc-warning-dark',
	RETIRED: 'bg-misc-danger/10 text-misc-danger',
	NEW: 'bg-misc-accent/10 text-misc-accent',
};

export interface FeatureChange {
	readonly name: string;
	readonly note: string;
	readonly outcome: FeatureOutcome;
}

export interface FeatureChangeGroup {
	readonly features: readonly FeatureChange[];
	readonly title: string;
}

export const FEATURE_CHANGE_GROUPS: readonly FeatureChangeGroup[] = [
	{
		title: 'Filters',
		features: [
			{
				name: 'Banned words',
				outcome: 'DIFFERENT',
				note: "Discord's own AutoMod does the word matching now, and AutoModerator decides what happens to whoever tripped it: warn, mute, kick, ban, or file a report.",
			},
			{
				name: 'URL filter',
				outcome: 'IMPROVED',
				note: 'Fixed various edge cases not covered by the current version of the bot.',
			},
			{
				name: 'Invite filter',
				outcome: 'IMPROVED',
				note: 'Fixed various edge cases not covered by the current version of the bot.',
			},
			{
				name: 'Anti-spam',
				outcome: 'IMPROVED',
				note: 'Now catches cross-channel spam.',
			},
			{
				name: 'Filter ladder',
				outcome: 'IMPROVED',
				note: 'Now triggered by link and invite violations as well.',
			},
			{
				name: 'Filter exemptions',
				outcome: 'DIFFERENT',
				note: "A channel is exempted from each filter separately. Word-filter exemptions move to Discord's rule settings, where the match is now made.",
			},
			{
				name: 'Bypass roles',
				outcome: 'UNCHANGED',
				note: 'Staff roles still skip every filter.',
			},
			{
				name: 'DM on trigger',
				outcome: 'UNCHANGED',
				note: 'People still get told why their message disappeared.',
			},
			{
				name: 'Report instead of delete (banned word)',
				outcome: 'DIFFERENT',
				note: 'Still here, just configured different.',
			},
			{
				name: 'Mention spam limits',
				outcome: 'RETIRED',
				note: "Discord's built-in AutoMod covers this one now.",
			},
			{
				name: 'NSFW image detection',
				outcome: 'RETIRED',
				note: 'Niche & unreliable API has lead to the decision to retire this for the time being.',
			},
			{
				name: 'Global malicious link list',
				outcome: 'RETIRED',
				note: 'The days of scam-domain-appeared-overnight spam have mostly passed - the list we used is no longer maintained.',
			},
			{
				name: 'Banned words in names',
				outcome: 'RETIRED',
				note: 'Handled better by native AutoMod.',
			},
		],
	},
	{
		title: 'Moderation and cases',
		features: [
			{
				name: 'Warn, mute, kick, ban, unban',
				outcome: 'UNCHANGED',
				note: 'Manual moderation is becoming more of a focus.',
			},
			{
				name: 'Case history',
				outcome: 'UNCHANGED',
				note: 'Every past case moves across with its number intact.',
			},
			{
				name: 'Warn ladder',
				outcome: 'UNCHANGED',
				note: 'Automatic punishments once warnings pile up.',
			},
			{
				name: 'Purge',
				outcome: 'UNCHANGED',
				note: 'All the same filters for cleaning up a channel.',
			},
			{
				name: 'Bans done by hand in Discord',
				outcome: 'IMPROVED',
				note: 'Better detection mechanism that should be less prone to missing bans.',
			},
			{
				name: 'Mute role',
				outcome: 'RETIRED',
				note: 'Mutes are Discord timeouts only from now on. Note the 28day limit.',
			},
			{
				name: 'Raid cleanup',
				outcome: 'RETIRED',
				note: "Mass-banning by account age or avatar is gone. Discord's own security actions and the members list cover it.",
			},
		],
	},
	{
		title: 'Reports',
		features: [
			{
				name: 'Report queue',
				outcome: 'IMPROVED',
				note: 'Miscellaneous improvements to the report system',
			},
			{
				name: 'Reporting a DM',
				outcome: 'NEW',
				note: 'Somebody harassed in DMs can attach the messages to a report from their own client and file it to a server they share with the sender. Staff read the real messages instead of a screenshot they have to take on faith.',
			},
		],
	},
	{
		title: 'Logging',
		features: [
			{
				name: 'Log channels',
				outcome: 'UNCHANGED',
				note: 'A channel per log type, and anything you leave unset stays off.',
			},
			{
				name: 'Mod action log',
				outcome: 'UNCHANGED',
				note: 'One post per case, rewritten in place when the case is edited.',
			},
			{
				name: 'Filter log',
				outcome: 'DIFFERENT',
				note: "Everything a filter caught reads in one place: Discord's word matches next to our own link, invite and spam hits, instead of two logs to check.",
			},
			{
				name: 'Message and profile logs',
				outcome: 'IMPROVED',
				note: 'Deleted messages (attempt to) name the moderator who removed them. Display name changes are tracked alongside nicknames and usernames.',
			},
			{
				name: 'Log exemptions',
				outcome: 'IMPROVED',
				note: 'Miscellaneous improvements related to threads.',
			},
		],
	},
	{
		title: 'Everything else',
		features: [
			{
				name: 'Minimum account age',
				outcome: 'UNCHANGED',
				note: 'Brand new accounts still get turned away at the door.',
			},
			{
				name: 'Kicking members with no avatar',
				outcome: 'RETIRED',
				note: 'No longer necessary in the current spam-bot climate.',
			},
			{
				name: 'Self-assignable roles',
				outcome: 'RETIRED',
				note: 'Replaced by native onboarding.',
			},
		],
	},
];

export function countByOutcome(outcome: FeatureOutcome): number {
	return FEATURE_CHANGE_GROUPS.reduce(
		(total, group) => total + group.features.filter((feature) => feature.outcome === outcome).length,
		0,
	);
}

export function featureCountLabel(count: number): string {
	return count === 1 ? '1 feature' : `${count} features`;
}
