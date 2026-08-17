import { MAX_TIMEOUT_SECONDS } from '@chatsift/core';
import { parseRelativeTimeSafe } from '@chatsift/parse-relative-time';
import type { WarnPunishmentActionName } from '@/api/routes/automoderatorWarnPunishments';

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
export const DURATION_RULE: Record<WarnPunishmentActionName, 'forbidden' | 'optional' | 'required'> = {
	MUTE: 'required',
	KICK: 'forbidden',
	BAN: 'optional',
};

/**
 * Largest unit first, matching `@chatsift/parse-relative-time`'s own values -- a month is 28 days there, not a
 * calendar month.
 */
const UNITS = [
	{ suffix: 'mo', name: 'month', seconds: 28 * 86_400 },
	{ suffix: 'w', name: 'week', seconds: 7 * 86_400 },
	{ suffix: 'd', name: 'day', seconds: 86_400 },
	{ suffix: 'h', name: 'hour', seconds: 3_600 },
	{ suffix: 'm', name: 'minute', seconds: 60 },
	{ suffix: 's', name: 'second', seconds: 1 },
] as const;

/**
 * The largest unit that divides the duration exactly.
 *
 * Exact rather than nearest, unlike `@chatsift/core`'s `formatCaseDuration`: that one rounds (90 minutes reads
 * as "2 hours"), which is right for prose about a case that already happened and wrong here, where the text it
 * produces is fed straight back through the parser when the step is saved again. Rounding would quietly turn a
 * 90-minute step into a two-hour one for anyone who opened it and pressed Save.
 */
function splitDuration(seconds: number): { name: string; suffix: string; value: number } {
	const unit = UNITS.find((candidate) => seconds % candidate.seconds === 0) ?? UNITS.at(-1)!;
	return { value: seconds / unit.seconds, suffix: unit.suffix, name: unit.name };
}

export type DurationParse = { message: string; ok: false } | { ok: true; seconds: number | null };

/**
 * Turns what someone typed into the seconds the API wants, using the same grammar the bot's `/mute` and `/ban`
 * accept -- so "7d" means the same thing on the dashboard as it does in Discord.
 */
export function parseDurationInput(raw: string, action: WarnPunishmentActionName): DurationParse {
	const trimmed = raw.trim();
	const rule = DURATION_RULE[action];

	if (rule === 'forbidden') {
		return { ok: true, seconds: null };
	}

	if (trimmed.length === 0) {
		return rule === 'required' ? { ok: false, message: 'A mute needs a duration.' } : { ok: true, seconds: null };
	}

	const parsed = parseRelativeTimeSafe(trimmed);
	if (!parsed.ok) {
		return { ok: false, message: parsed.message };
	}

	const seconds = Math.floor(parsed.value / 1_000);
	if (seconds < 1) {
		return { ok: false, message: 'That is shorter than a second.' };
	}

	if (action === 'MUTE' && seconds > MAX_TIMEOUT_SECONDS) {
		return { ok: false, message: 'Discord timeouts cap out at 28 days.' };
	}

	return { ok: true, seconds };
}

/**
 * Seconds back into something the field accepts, so opening a step and saving it unchanged is a no-op.
 */
export function formatDurationInput(durationSeconds: number | null): string {
	if (durationSeconds === null) {
		return '';
	}

	const { value, suffix } = splitDuration(durationSeconds);
	return `${value}${suffix}`;
}

export function describeStep(action: WarnPunishmentActionName, durationSeconds: number | null): string {
	if (durationSeconds === null) {
		return action === 'BAN' ? 'Ban permanently' : ACTION_LABELS[action];
	}

	const { value, name } = splitDuration(durationSeconds);
	return `${ACTION_LABELS[action]} for ${value} ${name}${value === 1 ? '' : 's'}`;
}
