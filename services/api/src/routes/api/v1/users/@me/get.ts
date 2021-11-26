import fetch from 'node-fetch';
import { Route, userAuth } from '@automoderator/rest';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';
import cookie from 'cookie';
import type { RESTGetAPICurrentUserGuildsResult } from 'discord-api-types/v9';
import { DiscordPermissions } from '@automoderator/discord-permissions';

@injectable()
export default class GetUsersMeRoute extends Route {
  public override readonly middleware = [userAuth()];

  public async handle(req: Request, res: Response) {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    const { perms, ...user } = req.user!;

    const cookies = cookie.parse(req.headers.cookie ?? '');
    const token = cookies.access_token ?? req.headers.authorization;

    const guilds: RESTGetAPICurrentUserGuildsResult = await fetch(`https://discord.com/api/v9/users/@me/guilds`, {
      headers: {
        authorization: `Bearer ${token}`
      }
    }).then(res => res.json());

    return res.end(
      JSON.stringify({
        ...user,
        guilds: guilds.filter(guild => guild.owner || new DiscordPermissions(BigInt(guild.permissions)).has('manageGuild'))
      })
    );
  }
}
