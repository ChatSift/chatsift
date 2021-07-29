import { injectable } from 'tsyringe';
import { jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import { FilterIgnoresController } from '#controllers';
import * as Joi from 'joi';
import { FilterIgnores } from '@automoderator/filter-ignores';
import { badRequest } from '@hapi/boom';
import type { Request, Response, NextHandler } from 'polka';
import type { Snowflake } from 'discord-api-types/v9';
import type { ApiPatchFiltersIgnoresChannelBody } from '@automoderator/core';

@injectable()
export default class PatchGuildsFiltersIgnoresChannelRoute extends Route {
  public override readonly middleware = [
    thirdPartyAuth(),
    jsonParser(),
    validate(
      Joi
        .object()
        .keys({
          value: Joi.string().required()
        })
        .required()
    )
  ];

  public constructor(
    public readonly controller: FilterIgnoresController
  ) {
    super();
  }

  public async handle(req: Request, res: Response, next: NextHandler) {
    const { gid, cid } = req.params as { gid: Snowflake; cid: Snowflake };
    const { value } = req.body as ApiPatchFiltersIgnoresChannelBody;

    try {
      new FilterIgnores(BigInt(value));
    } catch {
      return next(badRequest('Invalid bitfield value'));
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    const ignore = await this.controller.update({ guild_id: gid, channel_id: cid, value });
    return res.end(JSON.stringify(ignore));
  }
}
