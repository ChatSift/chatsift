import { SnowflakeRegex } from '@sapphire/discord-utilities';
import { z } from 'zod';
import { BotKindSchema } from '../bots/schema.js';

export const UserMeGuildSchema = z
	.object({
		id: z.string().regex(SnowflakeRegex),
		icon: z.string().nullable(),
		name: z.string(),
		bots: z.array(BotKindSchema),
	})
	.strict();

export const UserMeSchema = z
	.object({
		avatar: z.string().nullable(),
		username: z.string(),
		id: z.string().regex(SnowflakeRegex),
		guilds: z.array(UserMeGuildSchema),
	})
	.strict();

export type UserMeGuild = z.infer<typeof UserMeGuildSchema>;
export type UserMe = z.infer<typeof UserMeSchema>;
