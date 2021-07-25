import { Route, thirdPartyAuth, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { GuildUrlsController } from '#controllers';
import type { Request, Response } from 'polka';
import type { ApiGetGuildsFiltersUrlsQuery } from '@automoderator/core';
import type { Snowflake } from 'discord-api-types/v9';

@injectable()
export default class GetFiltersUrlsGuildRoute extends Route {
  public override readonly middleware = [
    thirdPartyAuth(),
    validate(
      Joi
        .object()
        .keys({
          page: Joi.number()
        })
        .required(),
      'query'
    )
  ];

  public constructor(
    public readonly controller: GuildUrlsController
  ) {
    super();
  }

  public async handle(req: Request, res: Response) {
    const { gid } = req.params as { gid: Snowflake };
    const { page } = req.query as unknown as ApiGetGuildsFiltersUrlsQuery;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(page == null ? await this.controller.getAll(gid) : await this.controller.get(page, gid)));
  }
}
