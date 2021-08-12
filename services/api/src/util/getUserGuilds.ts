import { DiscordPermissions } from '@automoderator/discord-permissions';
import { kLogger } from '@automoderator/injection';
import { internal } from '@hapi/boom';
import cookie from 'cookie';
import type { RESTGetAPICurrentUserGuildsResult } from 'discord-api-types/v9';
import fetch from 'node-fetch';
import type { Logger } from 'pino';
import type { NextHandler, Request } from 'polka';
import { container } from 'tsyringe';

export const getUserGuilds = async (req: Request, next: NextHandler, filtered: boolean) => {
  const logger = container.resolve<Logger>(kLogger);

  const cookies = cookie.parse(req.headers.cookie ?? '');
  const token = cookies.access_token ?? req.headers.authorization;

  const result = await fetch(
    'https://discord.com/api/v9/users/@me/guilds', {
      headers: {
        authorization: `Bearer ${token!}`
      }
    }
  );

  const data: RESTGetAPICurrentUserGuildsResult = await result.json();

  if (!result.ok) {
    logger.warn({
      route: req.originalUrl,
      userId: req.user!.id,
      data
    },
    'Recieved bad discord data while getting all user guilds');

    await next(internal(`Discord Error: ${result.statusText}`));
    return null;
  }

  return filtered ? data.filter(guild => new DiscordPermissions(BigInt(guild.permissions)).has('manageGuild')) : data;
};
