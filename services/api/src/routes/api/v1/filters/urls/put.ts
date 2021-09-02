import { UrlsController } from '#controllers';
import { ApiPutFiltersUrlsBody, MaliciousUrlCategory } from '@automoderator/core';
import { globalPermissions, jsonParser, Route, userAuth, validate } from '@automoderator/rest';
import * as Joi from 'joi';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';

@injectable()
export default class PutFiltersUrlsRoute extends Route {
  public override readonly middleware = [
    userAuth(),
    globalPermissions('manageUrlFilters'),
    jsonParser(),
    validate(
      Joi
        .array()
        .items(
          Joi.object()
            .keys({
              url: Joi.string().required(),
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

  public async handle(req: Request, res: Response) {
    const domains = (req.body as ApiPutFiltersUrlsBody).map(domain => ({ ...domain, admin: req.user!.id }));

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(await this.controller.add(domains)));
  }
}
