import { Route, thirdPartyAuth, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { LocalFiltersController } from '#controllers';
import type { Snowflake } from 'discord-api-types/v9';
import type { Request, Response } from 'polka';
import type { ApiGetGuildsFiltersLocalQuery } from '@automoderator/core';

@injectable()
export default class GetGuildsFiltersLocalRoute extends Route {
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
    public readonly controller: LocalFiltersController
  ) {
    super();
  }

  public async handle(req: Request, res: Response) {
    const { gid } = req.params as { gid: Snowflake };
    const { page } = req.query as unknown as ApiGetGuildsFiltersLocalQuery;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(page == null ? await this.controller.getAll(gid) : await this.controller.get(gid, page)));
  }
}
