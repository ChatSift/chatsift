import { MAX_TIMEOUT_SECONDS } from '@chatsift/core';
import type { WarnPunishmentActionName } from '@/api/routes/automoderatorWarnPunishments';
import type { DurationParse, DurationRule } from '@/utils/duration';
import { describeDuration, formatDurationInput, parseDurationInput as parseDuration } from '@/utils/duration';

export { formatDurationInput } from '@/utils/duration';
export type { DurationParse } from '@/utils/duration';

export const WARN_PUNISHMENT_ACTIONS = ['MUTE', 'KICK', 'BAN'] as const satisfies readonly WarnPunishmentActionName[];

export const ACTION_LABELS: Record<WarnPunishmentActionName, string> = {
	MUTE: 'Mute',
	KICK: 'Kick',
	BAN: 'Ban',
};

/**
 * Whether a step of this kind takes a duration, and whether it has to. A mute is a Discord timeout, which has no
 * open-ended form; a ban does, and that is what an empty box means there.
 */
export const DURATION_RULE: Record<WarnPunishmentActionName, DurationRule> = {
	MUTE: 'required',
	KICK: 'forbidden',
	BAN: 'optional',
};

/**
 * The ladder's wording over the shared parser in `@/utils/duration`. The grammar and the rounding rule are
 * shared with the banword policy editor; only the messages differ, because "a mute needs a duration" reads
 * better than a generic line and is the whole reason this wrapper exists rather than the call site passing
 * three options every time.
 */
export function parseDurationInput(raw: string, action: WarnPunishmentActionName): DurationParse {
	return parseDuration(raw, DURATION_RULE[action], {
		requiredMessage: 'A mute needs a duration.',
		...(action === 'MUTE'
			? { maxSeconds: MAX_TIMEOUT_SECONDS, overMaxMessage: 'Discord timeouts cap out at 28 days.' }
			: {}),
	});
}

export function describeStep(action: WarnPunishmentActionName, durationSeconds: number | null): string {
	if (durationSeconds === null) {
		return action === 'BAN' ? 'Ban permanently' : ACTION_LABELS[action];
	}

	return `${ACTION_LABELS[action]} for ${describeDuration(durationSeconds)}`;
}
