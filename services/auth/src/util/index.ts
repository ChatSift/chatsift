import { kConfig, kLogger, Config } from '@automoderator/injection';
import { container } from 'tsyringe';
import { forbidden, internal } from '@hapi/boom';
import fetch from 'node-fetch';
import type { AuthGetDiscordCallbackQuery, AuthGetDiscordRefreshBody } from '@automoderator/core';
import type { Request, Response, NextHandler } from 'polka';
import type { Logger } from 'pino';
import type { RESTPostOAuth2AccessTokenResult } from 'discord-api-types/v9';

export const discordOAuth2 = async (req: Request, _: Response, next: NextHandler) => {
  const config = container.resolve<Config>(kConfig);
  const logger = container.resolve<Logger>(kLogger);

  const form = new URLSearchParams({
    client_id: config.discordClientId,
    client_secret: config.discordClientSecret,
    redirect_uri: `${config.apiDomain}/api/auth/discord/callback`,
    scope: config.discordScopes
  });

  const code = (req.query as Partial<AuthGetDiscordCallbackQuery> | undefined)?.code;

  if (code) {
    form.append('grant_type', 'authorization_code');
    form.append('code', code);
  } else {
    form.append('grant_type', 'refresh_token');
    form.append('refresh_token', (req.body as AuthGetDiscordRefreshBody).refresh_token);
  }

  const result = await fetch(
    'https://discord.com/api/v9/oauth2/token', {
      method: 'POST',
      body: form.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );

  const oauthResponse: RESTPostOAuth2AccessTokenResult = await result.json();

  if (!result.ok) {
    logger.warn({
      data: oauthResponse,
      userId: req.user!.id
    }, 'Recieved weird discord data');

    return next(internal());
  }

  const { scope: returnedScope } = oauthResponse;
  if (returnedScope !== config.discordScopes) {
    return next(forbidden(`Expected scope "${config.discordScopes}" but received scope "${returnedScope}"`));
  }

  return oauthResponse;
};
