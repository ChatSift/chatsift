import { jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { GuildFilesController } from '#controllers';
import type { Request, Response } from 'polka';
import type { ApiPostGuildsFiltersFilesBody } from '@automoderator/core';
import type { Snowflake } from 'discord-api-types/v9';

@injectable()
export default class PostGuildsFiltersFilesRoute extends Route {
  public override readonly middleware = [
    thirdPartyAuth(),
    jsonParser(),
    validate(
      Joi
        .object()
        .keys({
          hashes: Joi
            .array()
            .items(Joi.string().required())
            .required(),
          guild_only: Joi
            .boolean()
            .default(false)
        })
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
    const { hashes, guild_only } = req.body as Required<ApiPostGuildsFiltersFilesBody>;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(await this.controller.getHitsFrom(hashes, gid, guild_only)));
  }
}
