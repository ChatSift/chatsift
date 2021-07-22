import { jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { GuildFilesController } from '#controllers';
import type { ApiDeleteGuildsFiltersFilesBody } from '@automoderator/core';
import type { Request, Response } from 'polka';
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

  public async handle(req: Request, res: Response) {
    const { gid } = req.params as { gid: Snowflake };
    const hashes = req.body as ApiDeleteGuildsFiltersFilesBody;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(await this.controller.delete(hashes, gid)));
  }
}
