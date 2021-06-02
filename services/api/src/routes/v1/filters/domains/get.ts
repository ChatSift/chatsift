import { jsonParser, Route, userAuth, permissions, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import type { DomainsController } from '#util';
import type { Request, Response } from 'polka';
import type { ApiGetFiltersDomainsQuery } from '@automoderator/core';

@injectable()
export default class GetFiltersDomainsRoute extends Route {
  public override readonly middleware = [
    userAuth(),
    permissions('manageDomainFilters'),
    jsonParser(),
    validate(
      Joi
        .object()
        .keys({
          page: Joi.number().required()
        })
        .required(),
      'query'
    )
  ];

  public constructor(
    public readonly controller: DomainsController
  ) {
    super();
  }

  public async handle(req: Request, res: Response) {
    const { page } = req.query as unknown as ApiGetFiltersDomainsQuery;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(await this.controller.get(page)));
  }
}
