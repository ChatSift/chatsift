import { injectable } from 'tsyringe';
import { Route, thirdPartyAuth } from '@automoderator/rest';
import { FilterIgnoresController } from '#controllers';
import { notFound } from '@hapi/boom';
import type { Request, Response, NextHandler } from 'polka';
import type { Snowflake } from 'discord-api-types/v9';

@injectable()
export default class DeleteGuildsFiltersIgnoresChannelRoute extends Route {
  public override readonly middleware = [thirdPartyAuth()];

  public constructor(
    public readonly controller: FilterIgnoresController
  ) {
    super();
  }

  public async handle(req: Request, res: Response, next: NextHandler) {
    const { cid } = req.params as { cid: Snowflake };

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    const ignore = await this.controller.delete(cid);

    if (!ignore) {
      return next(notFound('There was no ignore for this channel'));
    }

    return res.end(JSON.stringify(ignore));
  }
}
