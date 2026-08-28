import { MAX_TIMEOUT_SECONDS } from '@chatsift/core';
import type { TriggerPunishmentActionName } from '@/api/routes/automoderatorTriggerPunishments';
import type { DurationParse, DurationRule } from '@/utils/duration';
import { describeDuration, formatDurationInput, parseDurationInput as parseDuration } from '@/utils/duration';

export { formatDurationInput } from '@/utils/duration';
export type { DurationParse } from '@/utils/duration';

export const TRIGGER_PUNISHMENT_ACTIONS = [
	'WARN',
	'MUTE',
	'KICK',
	'BAN',
] as const satisfies readonly TriggerPunishmentActionName[];

export const ACTION_LABELS: Record<TriggerPunishmentActionName, string> = {
	WARN: 'Warn',
	MUTE: 'Mute',
	KICK: 'Kick',
	BAN: 'Ban',
};

/**
 * Whether a step of this kind takes a duration, and whether it has to. Mirrors the warn ladder's rules with
 * WARN joining KICK on the side that carries none -- a warning is a record, and there is nothing about it to
 * expire on a timer.
 */
export const DURATION_RULE: Record<TriggerPunishmentActionName, DurationRule> = {
	WARN: 'forbidden',
	MUTE: 'required',
	KICK: 'forbidden',
	BAN: 'optional',
};

export function parseDurationInput(raw: string, action: TriggerPunishmentActionName): DurationParse {
	return parseDuration(raw, DURATION_RULE[action], {
		requiredMessage: 'A mute needs a duration.',
		...(action === 'MUTE'
			? { maxSeconds: MAX_TIMEOUT_SECONDS, overMaxMessage: 'Discord timeouts cap out at 28 days.' }
			: {}),
	});
}

export function describeStep(action: TriggerPunishmentActionName, durationSeconds: number | null): string {
	if (durationSeconds === null) {
		return action === 'BAN' ? 'Ban permanently' : ACTION_LABELS[action];
	}

	return `${ACTION_LABELS[action]} for ${describeDuration(durationSeconds)}`;
}
