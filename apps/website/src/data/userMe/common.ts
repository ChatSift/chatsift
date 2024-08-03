import type { Snowflake } from 'discord-api-types/v10';

export type BotId = 'automoderator';

export interface UserMeResult {
	avatar: string | null;
	guilds: {
		bots: BotId[];
		icon: string | null;
		id: Snowflake;
		name: string;
	}[];
	id: Snowflake;
	username: string;
}

export const queryKey = ['userMe'];
export const path = '/auth/discord/@me';
