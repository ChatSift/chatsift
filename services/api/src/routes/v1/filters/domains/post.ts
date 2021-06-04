import { jsonParser, Route, thirdPartyAuth, globalPermissions, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import type { Request, Response } from 'polka';
import type { ApiPostFiltersDomainsBody } from '@automoderator/core';
import type { DomainsController } from '#controllers';

@injectable()
export default class PostFiltersDomainsRoute extends Route {
  public override readonly middleware = [
    thirdPartyAuth(),
    globalPermissions('useDomainFilters'),
    jsonParser(),
    validate(
      Joi
        .object()
        .keys({
          domains: Joi
            .array()
            .items(Joi.string().required())
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
    const { domains } = req.body as ApiPostFiltersDomainsBody;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(await this.controller.getHitsFrom(domains)));
  }
}
