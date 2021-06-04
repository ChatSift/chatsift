import { jsonParser, Route, userAuth, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { notFound } from '@hapi/boom';
import { getUserGuilds } from '#util';
import { ApiPatchFiltersDomainsBody, MaliciousDomainCategory } from '@automoderator/core';
import type { DomainsController } from '#controllers';
import type { Request, Response, NextHandler } from 'polka';

@injectable()
export default class PatchFiltersDomainsGuildRoute extends Route {
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
                .min(MaliciousDomainCategory.malicious)
                .max(MaliciousDomainCategory.urlShortner)
                .required()
            })
            .required()
        )
        .required(),
      'body'
    )
  ];

  public constructor(
    public readonly controller: DomainsController
  ) {
    super();
  }

  public async handle(req: Request, res: Response, next: NextHandler) {
    const { gid } = req.params;
    const domains = req.body as ApiPatchFiltersDomainsBody;

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
