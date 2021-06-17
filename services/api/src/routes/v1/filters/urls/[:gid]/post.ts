import { jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { notFound } from '@hapi/boom';
import { getUserGuilds } from '#util';
import type { Request, Response, NextHandler } from 'polka';
import type { ApiPostFiltersGuildUrlBody } from '@automoderator/core';
import type { UrlsController } from '#controllers';

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

  public async handle(req: Request, res: Response, next: NextHandler) {
    const { gid } = req.params;
    const { urls, guild_only } = req.body as Required<ApiPostFiltersGuildUrlBody>;

    const guilds = await getUserGuilds(req, next, true);
    if (!guilds?.length) return;

    const guild = guilds.find(g => g.id === gid);

    if (!guild) {
      return next(notFound('guild not found'));
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(await this.controller.getHitsFrom(urls, guild.id, guild_only)));
  }
}
