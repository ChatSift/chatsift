import { jsonParser, Route, userAuth, permissions, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { ApiPutFiltersDomainsBody, MaliciousDomainCategory } from '@automoderator/core';
import type { Request, Response } from 'polka';
import type { DomainsController } from '#util';

@injectable()
export default class PutFiltersDomainsRoute extends Route {
  public override readonly middleware = [
    userAuth(),
    permissions('manageDomainFilters'),
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

  public async handle(req: Request, res: Response) {
    const { domain, category } = req.body as ApiPutFiltersDomainsBody;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(await this.controller.add(domain, { admin: req.user!.id, category })));
  }
}
