import type { MeGuild } from '@chatsift/api';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const retryWrapper = (retry: (retries: number, error: Error) => boolean) => (retries: number, error: Error) => {
	if (process.env.NODE_ENV === 'development') {
		return false;
	}

	return retry(retries, error);
};

export const exponentialBackOff = (failureCount: number) => 2 ** failureCount * 1_000;

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
