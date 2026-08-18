export const REPORT_PROMPT_DEFAULT_TITLE = 'Got DMs to report?';

export const REPORT_PROMPT_DEFAULT_DESCRIPTION = [
	'You can report abuse happening in DMs in a way that guarantees the report is not fabricated',
	'**1.** Add AutoModerator to your account with the button below (you only have to do this once).',
	'**2.** In the DM, open the ⋯ menu on the message and pick **Apps → Add to Report Draft**. Add a few messages ' +
		'if the conversation needs context - including your own replies.',
	'**3.** Run `/submit-report` in that DM and follow the link to choose this server.',
].join('\n');

export const REPORT_PROMPT_DEFAULT_BUTTON_LABEL = 'Add AutoModerator to my account';

export function userInstallUrl(applicationId: string): string {
	return `https://discord.com/oauth2/authorize?client_id=${applicationId}&integration_type=1&scope=applications.commands`;
}
