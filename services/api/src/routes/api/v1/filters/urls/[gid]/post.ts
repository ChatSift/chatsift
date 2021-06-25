import { jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { UrlsController } from '#controllers';
import { resolveUrls } from '#util';
import type { Request, Response } from 'polka';
import type { ApiPostFiltersGuildUrlBody } from '@automoderator/core';

@injectable()
export default class PostFiltersUrlsGuildRoute extends Route {
  public override readonly middleware = [
    thirdPartyAuth(),
    jsonParser(),
    validate(
      Joi
        .object()
        .keys({
          urls: Joi
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
    public readonly controller: UrlsController
  ) {
    super();
  }

  public async handle(req: Request, res: Response) {
    const { gid } = req.params;
    const { urls, guild_only } = req.body as Required<ApiPostFiltersGuildUrlBody>;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(await this.controller.getHitsFrom([...resolveUrls(urls)], gid, guild_only)));
  }
}
