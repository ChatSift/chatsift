import { SettingsController } from '#controllers';
import { Route, thirdPartyAuth } from '@automoderator/rest';
import type { Snowflake } from 'discord-api-types/v9';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';

@injectable()
export default class GetGuildsSettingsRoute extends Route {
  public override readonly middleware = [thirdPartyAuth()];

  public constructor(
    public readonly controller: SettingsController
  ) {
    super();
  }

  public async handle(req: Request, res: Response) {
    const { gid } = req.params as { gid: Snowflake };

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    const settings = await this.controller.get(gid) ?? { guild_id: gid };
    return res.end(JSON.stringify(settings));
  }
}
