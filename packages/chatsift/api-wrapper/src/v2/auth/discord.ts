// /api/v2/auth/discord
import * as zod from 'zod';

export const GetAuthDiscordQuerySchema = zod.object({
	redirect_uri: zod.string(),
});
export type GetAuthDiscordQuery = zod.infer<typeof GetAuthDiscordQuerySchema>;
export type GetAuthDiscordResult = never;

export const GetAuthDiscordCallbackQuerySchema = zod.object({
	code: zod.string(),
	state: zod.string(),
});
export type GetAuthDiscordCallbackQuery = zod.infer<typeof GetAuthDiscordCallbackQuerySchema>;
export type GetAuthDiscordCallbackResult = never;
