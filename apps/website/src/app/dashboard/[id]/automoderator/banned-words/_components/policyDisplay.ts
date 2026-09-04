import { MAX_TIMEOUT_SECONDS } from '@chatsift/core';
import type { BanwordActionName } from '@/api/routes/automoderatorBanwords';
import type { DurationParse, DurationRule } from '@/utils/duration';
import { describeDuration, parseDurationInput as parseDuration } from '@/utils/duration';

export const BANWORD_ACTIONS = [
	'WARN',
	'MUTE',
	'KICK',
	'BAN',
	'REPORT',
] as const satisfies readonly BanwordActionName[];

export const ACTION_LABELS: Record<BanwordActionName, string> = {
	WARN: 'Warn',
	MUTE: 'Mute',
	KICK: 'Kick',
	BAN: 'Ban',
	REPORT: 'Report',
};

/**
 * Mirrors `automoderator_banword_policies_duration_check`. A mute is a Discord timeout, which has no open-ended
 * form, so it must carry one; a ban reads both ways and an empty box is what makes it permanent; the other
 * three have no duration to serve.
 */
export const DURATION_RULE: Record<BanwordActionName, DurationRule> = {
	WARN: 'forbidden',
	MUTE: 'required',
	KICK: 'forbidden',
	BAN: 'optional',
	REPORT: 'forbidden',
};

export const DURATION_HELP: Record<BanwordActionName, string> = {
	WARN: 'Warnings have no duration, but they do feed the warn ladder, which does.',
	MUTE: 'How long the timeout lasts, e.g. "30m", "2h", "7d". Discord timeouts cap out at 28 days.',
	KICK: 'Kicks have no duration.',
	BAN: 'How long the ban lasts, e.g. "7d", "3mo". Leave empty to ban permanently.',
	REPORT: 'Reports have no duration.',
};

/**
 * The policy editor's wording over the shared parser in `@/utils/duration`, the same arrangement the warn
 * ladder's `ladderDisplay.ts` uses.
 */
export function parsePolicyDuration(raw: string, action: BanwordActionName): DurationParse {
	return parseDuration(raw, DURATION_RULE[action], {
		requiredMessage: 'A mute needs a duration.',
		...(action === 'MUTE'
			? { maxSeconds: MAX_TIMEOUT_SECONDS, overMaxMessage: 'Discord timeouts cap out at 28 days.' }
			: {}),
	});
}

export function describePolicy(action: BanwordActionName, durationSeconds: number | null): string {
	if (durationSeconds === null) {
		return action === 'BAN' ? 'Ban permanently' : ACTION_LABELS[action];
	}

	return `${ACTION_LABELS[action]} for ${describeDuration(durationSeconds)}`;
}
