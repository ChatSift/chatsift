/* istanbul ignore file */
import type { AuthGetDiscordCallbackQuery, AuthGetDiscordRefreshBody } from '@automoderator/core';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import { forbidden, internal } from '@hapi/boom';
import type { RESTPostOAuth2AccessTokenResult } from 'discord-api-types/v9';
import fetch from 'node-fetch';
import type { Logger } from 'pino';
import type { NextHandler, Request, Response } from 'polka';
import { container } from 'tsyringe';
import cookie from 'cookie';
import { URLSearchParams } from 'url';

export const discordOAuth2 = async (req: Request, _: Response, next: NextHandler, redirectUri: string) => {
	const config = container.resolve<Config>(kConfig);
	const logger = container.resolve<Logger>(kLogger);

	const form = new URLSearchParams({
		client_id: config.discordClientId,
		client_secret: config.discordClientSecret,
		redirect_uri: redirectUri,
		// redirect_uri: `${config.apiDomain}/api/v2/auth/discord/callback`,
		scope: config.discordScopes,
	});

	const code = (req.query as Partial<AuthGetDiscordCallbackQuery> | undefined)?.code;

	if (code) {
		form.append('grant_type', 'authorization_code');
		form.append('code', code);
	} else {
		const cookies = cookie.parse(req.headers.cookie ?? '');

		form.append('grant_type', 'refresh_token');
		form.append(
			'refresh_token',
			(cookies.refresh_token ?? (req.body as AuthGetDiscordRefreshBody | undefined)?.refresh_token)!,
		);
	}

	const result = await fetch('https://discord.com/api/v9/oauth2/token', {
		method: 'POST',
		body: form.toString(),
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
	});

	const oauthResponse = (await result.json()) as RESTPostOAuth2AccessTokenResult;

	if (!result.ok) {
		logger.warn(
			{
				data: oauthResponse,
			},
			'Recieved weird discord data',
		);

		return next(internal());
	}

	const { scope: returnedScope } = oauthResponse;
	if (returnedScope !== config.discordScopes) {
		return next(forbidden(`Expected scope "${config.discordScopes}" but received scope "${returnedScope}"`));
	}

	return oauthResponse;
};
