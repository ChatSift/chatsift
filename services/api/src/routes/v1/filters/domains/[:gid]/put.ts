import { jsonParser, Route, userAuth, globalPermissions, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { ApiPutFiltersDomainsGuildBody, MaliciousDomainCategory } from '@automoderator/core';
import { notFound } from '@hapi/boom';
import { getUserGuilds } from '#util';
import type { Request, Response, NextHandler } from 'polka';
import type { DomainsController } from '#controllers';

@injectable()
export default class PutFiltersDomainsGuildRoute extends Route {
  public override readonly middleware = [
    userAuth(),
    globalPermissions('manageDomainFilters'),
    jsonParser(),
    validate(
      Joi
        .object()
        .keys({
          domain: Joi.string().required(),
          category: Joi.number()
            .min(MaliciousDomainCategory.malicious)
            .max(MaliciousDomainCategory.urlShortner)
            .required()
        })
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
    const { domain } = req.body as ApiPutFiltersDomainsGuildBody;

    const guilds = await getUserGuilds(req, next, true);
    if (!guilds?.length) return;

    const guild = guilds.find(g => g.id === gid);

    if (!guild) {
      return next(notFound('guild not found'));
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(await this.controller.add(domain, { guild: guild.id })));
  }
}
