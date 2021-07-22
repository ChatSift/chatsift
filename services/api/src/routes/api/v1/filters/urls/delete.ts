import { jsonParser, Route, userAuth, globalPermissions, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { ApiDeleteFiltersUrlsBody } from '@automoderator/core';
import type { Request, Response } from 'polka';
import { UrlsController } from '#controllers';

@injectable()
export default class DeleteFiltersUrlsRoute extends Route {
  public override readonly middleware = [
    userAuth(),
    globalPermissions('manageUrlFilters'),
    jsonParser(),
    validate(
      Joi
        .array()
        .items(Joi.number().required())
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
    const domains = req.body as ApiDeleteFiltersUrlsBody;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(await this.controller.delete(domains)));
  }
}
