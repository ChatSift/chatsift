import { jsonParser, Route, userAuth, globalPermissions, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { UrlsController } from '#controllers';
import type { Request, Response } from 'polka';
import type { ApiGetFiltersUrlsQuery } from '@automoderator/core';

@injectable()
export default class GetFiltersUrlsRoute extends Route {
  public override readonly middleware = [
    userAuth(),
    globalPermissions('manageUrlFilters'),
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
    public readonly controller: UrlsController
  ) {
    super();
  }

  public async handle(req: Request, res: Response) {
    const { page } = req.query as unknown as ApiGetFiltersUrlsQuery;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(await this.controller.get(page)));
  }
}
