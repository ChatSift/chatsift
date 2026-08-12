import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { MeGuild } from '@/api/routes/auth';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/**
 * Most-configured servers first, then alphabetically.
 *
 * The name tiebreak isn't cosmetic (#321): this used to be `reverse().sort(byBotCount)`, and since `Array#sort`
 * is stable, every equal-bot-count group silently fell back to reverse-`/me` order -- which puts AMA-guest-only
 * guilds last, because `fetchMe` appends the ones the viewer isn't a Discord member of after everything else.
 * Sorting on something intrinsic to the guild instead makes the order deterministic and independent of how the
 * API happened to assemble the list.
 */
export const sortGuilds = (guilds: MeGuild[]) =>
	guilds.slice().sort((a, b) => b.bots.length - a.bots.length || a.name.localeCompare(b.name));

/**
 * A Discord role's colour as CSS. `0` is Discord's "no colour" sentinel and renders as its default grey rather
 * than black -- as does a role that couldn't be resolved at all, which callers pass `undefined` for.
 */
export const roleColor = (color: number | null | undefined): string =>
	color ? `#${color.toString(16).padStart(6, '0')}` : '#99aab5';

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
 * Formats a `Date` for a native `<input type="datetime-local">`'s `value` -- that control reads/writes
 * `YYYY-MM-DDTHH:mm` in the browser's local timezone with no offset, which `Date#toISOString()` can't
 * produce directly (it's always UTC). Pairs with `datetimeLocalValueToISOString` below for the reverse
 * direction.
 */
export const dateToDatetimeLocalValue = (date: Date): string => {
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/**
 * The reverse of `dateToDatetimeLocalValue` -- `new Date(...)` already parses an offset-less
 * `YYYY-MM-DDTHH:mm` string as local time, so this is just the ISO-string round trip the API schema
 * (`z.iso.datetime()`) expects. Returns `undefined` for an empty/cleared input.
 */
export const datetimeLocalValueToISOString = (value: string): string | undefined =>
	value ? new Date(value).toISOString() : undefined;

const DISCORD_EPOCH = 1_420_070_400_000n;

/**
 * `thread_messages` (#261) has no `createdAt` column of its own -- the message's own Discord snowflake id
 * already encodes its creation time, so the dashboard derives it from that instead of adding a redundant
 * column that could ever drift from the id it's decoded from.
 */
export const discordSnowflakeToDate = (snowflake: string): Date =>
	new Date(Number((BigInt(snowflake) >> 22n) + DISCORD_EPOCH));

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
