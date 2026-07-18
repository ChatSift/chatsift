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
 * Unlike `Number.parseInt`, doesn't silently truncate trailing garbage ("5.7" -> 5, "5abc" -> 5) or coerce
 * non-plain-integer syntax ("1e1" -> 10) — only a string of plain (optionally signed) digits parses, everything
 * else (blank, decimals, scientific notation, malformed) is `NaN`, so it reaches the zod schema's `.int()`/range
 * checks and fails there instead of silently becoming a value the user never typed.
 */
export const parseIntegerInput = (value: string): number => {
	const trimmed = value.trim();
	return /^-?\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
};
