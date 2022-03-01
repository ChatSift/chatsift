import * as zod from 'zod';

export const DiscordSnowflakeSchema = zod.string().regex(/\d{17,19}/);
