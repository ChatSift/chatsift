import { jsonParser, Route, userAuth, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { notFound } from '@hapi/boom';
import { getUserGuilds } from '#util';
import { ApiPatchFiltersUrlsBody, MaliciousUrlCategory } from '@automoderator/core';
import type { UrlsController } from '#controllers';
import type { Request, Response, NextHandler } from 'polka';

@injectable()
export default class PatchFiltersUrlsGuildRoute extends Route {
  public override readonly middleware = [
    userAuth(),
    jsonParser(),
    validate(
      Joi
        .array()
        .items(
          Joi.object()
            .keys({
              domain: Joi.string().required(),
              category: Joi.number()
                .min(MaliciousUrlCategory.malicious)
                .max(MaliciousUrlCategory.urlShortner)
                .required()
            })
            .required()
        )
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
    const domains = req.body as ApiPatchFiltersUrlsBody;

    const guilds = await getUserGuilds(req, next, true);
    if (!guilds?.length) return;

    const guild = guilds.find(g => g.id === gid);

    if (!guild) {
      return next(notFound('guild not found'));
    }

    const result = await this.controller.updateBulk(domains);

    if (!result.success) {
      return next(notFound(result.error));
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(result.value));
  }
}
