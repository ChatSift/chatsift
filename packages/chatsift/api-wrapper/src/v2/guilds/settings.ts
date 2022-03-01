// /api/v2/guilds/[gid]/settings
import * as zod from 'zod';

import type { GuildSettings } from '@prisma/client';
import { DiscordSnowflakeSchema } from '../../common';

// GET /
export type GetGuildsSettingsResult = GuildSettings;

// PATCH /
export const PatchGuildsSettingsBodySchema = zod
	.object({
		modRole: DiscordSnowflakeSchema.nullable(),
		adminRole: DiscordSnowflakeSchema.nullable(),
		muteRole: DiscordSnowflakeSchema.nullable(),
		autoPardonWarnsAfter: zod.number().min(1).max(365).nullable(),
		useUrlFilters: zod.boolean(),
		useGlobalFilters: zod.boolean(),
		useFileFilters: zod.boolean(),
		useInviteFilters: zod.boolean(),
		modActionLogChannel: DiscordSnowflakeSchema.nullable(),
		filterTriggerLogChannel: DiscordSnowflakeSchema.nullable(),
		userUpdateLogChannel: DiscordSnowflakeSchema.nullable(),
		messageUpdateLogChannel: DiscordSnowflakeSchema.nullable(),
		minJoinAge: zod.number().nullable(),
		noBlankAvatar: zod.boolean(),
		reportsChannel: DiscordSnowflakeSchema.nullable(),
		antispamAmount: zod.number().min(2).max(20).nullable(),
		antispamTime: zod.number().min(2).max(20).nullable(),
		mentionLimit: zod.number().min(3),
		mentionAmount: zod.number().min(3),
		mentionTime: zod.number().min(2).max(20),
		automodCooldown: zod.number().nullable(),
		hentaiThreshold: zod.number().min(0).max(100).nullable(),
		pornThreshold: zod.number().min(0).max(100).nullable(),
		sexyThreshold: zod.number().min(0).max(100).nullable(),
	})
	.partial();
export type PatchGuildsSettingsBody = zod.infer<typeof PatchGuildsSettingsBodySchema>;
export type PatchGuildsSettingsResult = GuildSettings;
