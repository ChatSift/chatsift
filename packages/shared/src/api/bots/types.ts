import type { z } from 'zod';
import type { BOTS, ConfigSchema } from './schema.js';

export type BotId = (typeof BOTS)[number];
export type Config = z.infer<typeof ConfigSchema>;
