import { LocalFiltersController } from '#controllers';
import type { ApiPatchGuildsFiltersLocalBody } from '@automoderator/core';
import { jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import type { Snowflake } from 'discord-api-types/v9';
import * as Joi from 'joi';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';

@injectable()
export default class PatchGuildsFiltersLocalRoute extends Route {
  public override readonly middleware = [
    thirdPartyAuth(),
    jsonParser(),
    validate(
      Joi
        .object()
        .keys({
          word: Joi.string().required(),
          flags: Joi.string().default('0'),
          duration: Joi.number()
            .allow(null)
            .default(null)
        })
        .required(),
      'body'
    )
  ];

  public constructor(
    public readonly controller: LocalFiltersController
  ) {
    super();
  }

  public async handle(req: Request, res: Response) {
    const { gid } = req.params as { gid: Snowflake };
    const data = req.body as Required<ApiPatchGuildsFiltersLocalBody>;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(await this.controller.update(gid, data)));
  }
}
