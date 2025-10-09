import { SnowflakeRegex } from '@sapphire/discord-utilities';
import z from 'zod';

export const snowflakeSchema = z.string().regex(SnowflakeRegex);
