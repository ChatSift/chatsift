import { UrlsController } from '#controllers';
import { resolveUrls } from '#util';
import type { ApiPostFiltersUrlsBody } from '@automoderator/core';
import { globalPermissions, jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import * as Joi from 'joi';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';

@injectable()
export default class PostFiltersUrlsRoute extends Route {
  public override readonly middleware = [
    thirdPartyAuth(),
    globalPermissions('useUrlFilters'),
    jsonParser(),
    validate(
      Joi
        .object()
        .keys({
          urls: Joi
            .array()
            .items(Joi.string().required())
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
    const { urls } = req.body as ApiPostFiltersUrlsBody;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(await this.controller.getHitsFrom([...resolveUrls(urls)])));
  }
}
