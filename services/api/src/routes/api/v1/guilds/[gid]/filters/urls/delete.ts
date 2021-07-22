import { jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { ApiDeleteGuildsFiltersUrlsBody } from '@automoderator/core';
import { GuildUrlsController } from '#controllers';
import { notFound } from '@hapi/boom';
import type { Request, Response, NextHandler } from 'polka';
import type { Snowflake } from 'discord-api-types/v9';

@injectable()
export default class DeleteGuildsFiltersUrlsRoute extends Route {
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

  public async handle(req: Request, res: Response, next: NextHandler) {
    const { gid } = req.params as { gid: Snowflake };
    const urls = req.body as ApiDeleteGuildsFiltersUrlsBody;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    const deletes = await this.controller.delete(urls, gid);

    if (!deletes.length) {
      return next(notFound('None of the given URLs could be found'));
    }

    return res.end(JSON.stringify(deletes));
  }
}
