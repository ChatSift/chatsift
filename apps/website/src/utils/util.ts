import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { MeGuild } from '@/api/routes/auth';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const sortGuilds = (guilds: MeGuild[]) =>
	guilds
		.slice()
		.reverse()
		.sort((a, b) => b.bots.length - a.bots.length);

export const getGuildAcronym = (guildName: string) =>
	guildName
		.replaceAll("'s ", ' ')
		.replaceAll(/\w+/g, (substring) => substring[0]!)
		.replaceAll(/\s/g, '');

export const formatDate = (date: Date) =>
	new Intl.DateTimeFormat('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	}).format(date);

/**
 * Unlike `Number.parseInt`, doesn't silently truncate trailing garbage ("5.7" -> 5, "5abc" -> 5) — the full
 * string has to be a valid number or this is `NaN`, so decimal/malformed input reaches the zod schema's `.int()`
 * check (and fails there) instead of being coerced into a value the user never typed. Blank/whitespace-only input
 * is also `NaN` rather than `Number('')`'s `0`, so clearing the field is a validation error, not a silent default.
 */
export const parseIntegerInput = (value: string): number => {
	const trimmed = value.trim();
	return trimmed === '' ? Number.NaN : Number(trimmed);
};
