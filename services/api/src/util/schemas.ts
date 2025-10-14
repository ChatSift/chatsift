import { SnowflakeRegex } from '@sapphire/discord-utilities';
import z from 'zod';

export const snowflakeSchema = z.string().regex(SnowflakeRegex);

export const queryWithFreshSchema = z.strictObject({
	force_fresh: z.stringbool().optional().default(false),
});
