import { jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { GuildFilesController } from '#controllers';
import { notFound } from '@hapi/boom';
import type { ApiDeleteGuildsFiltersFilesBody } from '@automoderator/core';
import type { Request, Response, NextHandler } from 'polka';
import type { Snowflake } from 'discord-api-types/v8';

@injectable()
export default class DeleteGuildsFiltersFilesRoute extends Route {
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
    public readonly controller: GuildFilesController
  ) {
    super();
  }

  public async handle(req: Request, res: Response, next: NextHandler) {
    const { gid } = req.params as { gid: Snowflake };
    const hashes = req.body as ApiDeleteGuildsFiltersFilesBody;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    const deletes = await this.controller.delete(hashes, gid);

    if (!deletes.length) {
      return next(notFound('None of the given hashes could be found'));
    }

    return res.end(JSON.stringify(deletes));
  }
}
