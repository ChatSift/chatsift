// /api/v2/auth/discord
import * as zod from 'zod';

// GET /
export const GetAuthDiscordQuerySchema = zod.object({
	redirect_uri: zod.string(),
});
export type GetAuthDiscordQuery = zod.infer<typeof GetAuthDiscordQuerySchema>;
export type GetAuthDiscordResult = never;

// GET /callback
export const GetAuthDiscordCallbackQuerySchema = zod.object({
	code: zod.string(),
	state: zod.string(),
});
export type GetAuthDiscordCallbackQuery = zod.infer<typeof GetAuthDiscordCallbackQuerySchema>;
export type GetAuthDiscordCallbackResult = never;

// GET /logout
export const GetAuthDiscordLogoutQuerySchema = zod.object({
	redirect_uri: zod.string(),
});
export type GetAuthDiscordLogoutQuery = zod.infer<typeof GetAuthDiscordLogoutQuerySchema>;
export type GetAuthDiscordLogoutResult = never;

// GET /refresh
export const GetAuthDiscordRefreshBodySchema = zod
	.object({
		refresh_token: zod.string(),
	})
	.optional();
export type GetAuthDiscordRefreshBody = zod.infer<typeof GetAuthDiscordRefreshBodySchema>;
export type GetAuthDiscordRefreshResult = never;
