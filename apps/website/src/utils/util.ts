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
