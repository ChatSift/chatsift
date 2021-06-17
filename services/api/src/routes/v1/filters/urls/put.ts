import { jsonParser, Route, userAuth, globalPermissions, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { ApiPutFiltersUrlsBody, MaliciousUrlCategory } from '@automoderator/core';
import type { Request, Response } from 'polka';
import type { UrlsController } from '#controllers';

@injectable()
export default class PutFiltersUrlsRoute extends Route {
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

  public async handle(req: Request, res: Response) {
    const { url, category } = req.body as ApiPutFiltersUrlsBody;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(await this.controller.add(url, { admin: req.user!.id, category })));
  }
}
