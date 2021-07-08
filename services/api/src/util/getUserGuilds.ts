import { container } from 'tsyringe';
import { kLogger } from '@automoderator/injection';
import cookie from 'cookie';
import { DiscordPermissions } from '@automoderator/discord-permissions';
import { internal } from '@hapi/boom';
import fetch from 'node-fetch';
import type { Logger } from 'pino';
import type { Request, NextHandler } from 'polka';
import type { RESTGetAPICurrentUserGuildsResult } from 'discord-api-types/v8';

export const getUserGuilds = async (req: Request, next: NextHandler, filtered: boolean) => {
  const logger = container.resolve<Logger>(kLogger);

  const cookies = cookie.parse(req.headers.cookie ?? '');
  const token = cookies.access_token ?? req.headers.authorization;

  const result = await fetch(
    'https://discord.com/api/v8/users/@me/guilds', {
      headers: {
        authorization: `Bearer ${token!}`
      }
    }
  );

  const data: RESTGetAPICurrentUserGuildsResult = await result.json();

  if (!result.ok) {
    logger.warn(
      { topic: 'GET USER GUILDS', route: req.originalUrl, userId: req.user!.id, data },
      'Recieved bad discord data while getting all user guilds'
    );

    await next(internal(`Discord Error: ${result.statusText}`));
    return null;
  }

  return filtered ? data.filter(guild => new DiscordPermissions(BigInt(guild.permissions)).has('manageGuild')) : data;
};
