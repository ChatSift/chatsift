// /api/v2/guilds/[gid]/settings
import type { GuildSettings } from '@prisma/client';

// GET /
export type GetGuildsSettingsResult = GuildSettings;
