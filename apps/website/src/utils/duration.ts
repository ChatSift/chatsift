import { parseRelativeTimeSafe } from '@chatsift/parse-relative-time';

/**
 * Duration entry, shared by every AutoModerator screen that asks how long a punishment lasts -- the warn
 * ladder's rungs (P2) and the banword policy editor (P5).
 *
 * Factored out of `warn-ladder/_components/ladderDisplay.ts`, which owned it alone until a second editor needed
 * the identical grammar. Keeping one copy matters more than usual here: the text these functions produce is fed
 * straight back through the parser the next time somebody opens the form, so two implementations that disagree
 * by a rounding rule would quietly change a saved duration on any screen that used the wrong one.
 */

/**
 * Whether an action takes a duration, and whether it has to. A mute is a Discord timeout, which has no
 * open-ended form; a ban does, and an empty box is what selects it.
 */
export type DurationRule = 'forbidden' | 'optional' | 'required';

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
 * produces is fed straight back through the parser when the row is saved again. Rounding would quietly turn a
 * 90-minute rung into a two-hour one for anyone who opened it and pressed Save.
 */
export function splitDuration(seconds: number): { name: string; suffix: string; value: number } {
	const unit = UNITS.find((candidate) => seconds % candidate.seconds === 0) ?? UNITS.at(-1)!;
	return { value: seconds / unit.seconds, suffix: unit.suffix, name: unit.name };
}

export type DurationParse = { message: string; ok: false } | { ok: true; seconds: number | null };

export interface ParseDurationOptions {
	/**
	 * The ceiling, when the action has one. Only a timeout does -- Discord's own 28-day cap -- so this is
	 * absent for a ban, whose expiry the scheduler honours rather than Discord.
	 */
	readonly maxSeconds?: number;
	/**
	 * Shown when the value exceeds `maxSeconds`.
	 */
	readonly overMaxMessage?: string;
	/**
	 * Shown when the field is empty and the rule is `required`.
	 */
	readonly requiredMessage?: string;
}

/**
 * Turns what someone typed into the seconds the API wants, using the same grammar the bot's `/mute` and `/ban`
 * accept -- so "7d" means the same thing on the dashboard as it does in Discord.
 */
export function parseDurationInput(raw: string, rule: DurationRule, options: ParseDurationOptions = {}): DurationParse {
	const trimmed = raw.trim();

	if (rule === 'forbidden') {
		return { ok: true, seconds: null };
	}

	if (trimmed.length === 0) {
		return rule === 'required'
			? { ok: false, message: options.requiredMessage ?? 'This action needs a duration.' }
			: { ok: true, seconds: null };
	}

	const parsed = parseRelativeTimeSafe(trimmed);
	if (!parsed.ok) {
		return { ok: false, message: parsed.message };
	}

	const seconds = Math.floor(parsed.value / 1_000);
	if (seconds < 1) {
		return { ok: false, message: 'That is shorter than a second.' };
	}

	if (options.maxSeconds !== undefined && seconds > options.maxSeconds) {
		return { ok: false, message: options.overMaxMessage ?? 'That is longer than this action allows.' };
	}

	return { ok: true, seconds };
}

/**
 * Seconds back into something the field accepts, so opening a row and saving it unchanged is a no-op.
 */
export function formatDurationInput(durationSeconds: number | null): string {
	if (durationSeconds === null) {
		return '';
	}

	const { value, suffix } = splitDuration(durationSeconds);
	return `${value}${suffix}`;
}

/**
 * A duration in prose, for a summary line rather than an input.
 */
export function describeDuration(durationSeconds: number): string {
	const { value, name } = splitDuration(durationSeconds);
	return `${value} ${name}${value === 1 ? '' : 's'}`;
}
