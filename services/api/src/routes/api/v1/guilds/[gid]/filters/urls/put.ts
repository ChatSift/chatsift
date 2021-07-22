import { jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { GuildUrlsController } from '#controllers';
import type { Request, Response } from 'polka';
import type { ApiPutGuildsFiltersUrlsBody } from '@automoderator/core';
import type { Snowflake } from 'discord-api-types/v8';

@injectable()
export default class PutFiltersUrlsGuildRoute extends Route {
  public override readonly middleware = [
    thirdPartyAuth(),
    jsonParser(),
    validate(
      Joi
        .array()
        .items(Joi.string().required())
        .required(),
      'body'
    )
  ];

  public constructor(
    public readonly controller: GuildUrlsController
  ) {
    super();
  }

  public async handle(req: Request, res: Response) {
    const { gid } = req.params as { gid: Snowflake };
    const urls = req.body as ApiPutGuildsFiltersUrlsBody;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(await this.controller.add(urls, gid)));
  }
}
