import { jsonParser, Route, userAuth, globalPermissions, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { ApiPutFiltersUrlsGuildBody, MaliciousUrlCategory } from '@automoderator/core';
import { notFound } from '@hapi/boom';
import { getUserGuilds } from '#util';
import type { Request, Response, NextHandler } from 'polka';
import type { UrlsController } from '#controllers';

@injectable()
export default class PutFiltersUrlsGuildRoute extends Route {
  public override readonly middleware = [
    userAuth(),
    globalPermissions('manageUrlFilters'),
    jsonParser(),
    validate(
      Joi
        .object()
        .keys({
          url: Joi.string().required(),
          category: Joi.number()
            .min(MaliciousUrlCategory.malicious)
            .max(MaliciousUrlCategory.urlShortner)
            .required()
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
    const { url } = req.body as ApiPutFiltersUrlsGuildBody;

    const guilds = await getUserGuilds(req, next, true);
    if (!guilds?.length) return;

    const guild = guilds.find(g => g.id === gid);

    if (!guild) {
      return next(notFound('guild not found'));
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(await this.controller.add(url, { guild: guild.id })));
  }
}
