import { injectable } from 'tsyringe';
import { Route, thirdPartyAuth } from '@automoderator/rest';
import { FilterIgnoresController } from '#controllers';
import type { Request, Response } from 'polka';
import type { Snowflake } from 'discord-api-types/v9';

@injectable()
export default class GetGuildsFiltersIgnoresChannelRoute extends Route {
  public override readonly middleware = [thirdPartyAuth()];

  public constructor(
    public readonly controller: FilterIgnoresController
  ) {
    super();
  }

  public async handle(req: Request, res: Response) {
    const { gid, cid } = req.params as { gid: Snowflake; cid: Snowflake };

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    const ignore = await this.controller.get(cid) ?? { guild_id: gid, channel_id: cid, value: '0' };
    return res.end(JSON.stringify(ignore));
  }
}
