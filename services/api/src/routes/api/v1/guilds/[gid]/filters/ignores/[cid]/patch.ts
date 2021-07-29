import { injectable } from 'tsyringe';
import { jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import { FilterIgnoresController } from '#controllers';
import * as Joi from 'joi';
import type { Request, Response } from 'polka';
import type { Snowflake } from 'discord-api-types/v9';
import type { ApiPatchSettingsIgnoresChannelBody } from '@automoderator/core';

@injectable()
export default class PatchGuildsFiltersIgnoresChannelRoute extends Route {
  public override readonly middleware = [
    thirdPartyAuth(),
    jsonParser(),
    validate(
      Joi
        .object()
        .keys({
          value: Joi.number()
            .min(0)
            .required()
        })
        .required()
    )
  ];

  public constructor(
    public readonly controller: FilterIgnoresController
  ) {
    super();
  }

  public async handle(req: Request, res: Response) {
    const { gid, cid } = req.params as { gid: Snowflake; cid: Snowflake };
    const { value } = req.body as ApiPatchSettingsIgnoresChannelBody;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    const ignore = await this.controller.update({ guild_id: gid, channel_id: cid, value });
    return res.end(JSON.stringify(ignore));
  }
}
