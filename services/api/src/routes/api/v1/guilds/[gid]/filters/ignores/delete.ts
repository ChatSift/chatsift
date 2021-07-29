import { injectable } from 'tsyringe';
import { Route, thirdPartyAuth } from '@automoderator/rest';
import { FilterIgnoresController } from '#controllers';
import { notFound } from '@hapi/boom';
import type { Request, Response, NextHandler } from 'polka';
import type { Snowflake } from 'discord-api-types/v9';

@injectable()
export default class DeleteGuildsFiltersIgnoresRoute extends Route {
  public override readonly middleware = [thirdPartyAuth()];

  public constructor(
    public readonly controller: FilterIgnoresController
  ) {
    super();
  }

  public async handle(req: Request, res: Response, next: NextHandler) {
    const { gid } = req.params as { gid: Snowflake };

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    const ignores = await this.controller.deleteAll(gid);

    if (!ignores.length) {
      return next(notFound('There were no ignores for this guild'));
    }

    return res.end(JSON.stringify(ignores));
  }
}
