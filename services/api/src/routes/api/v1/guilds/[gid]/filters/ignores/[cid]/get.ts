import { FilterIgnoresController } from '#controllers';
import { Route, thirdPartyAuth } from '@automoderator/rest';
import type { Snowflake } from 'discord-api-types/v9';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';

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
