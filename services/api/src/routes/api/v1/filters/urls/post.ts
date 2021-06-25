import { jsonParser, Route, thirdPartyAuth, globalPermissions, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { UrlsController } from '#controllers';
import { resolveUrls } from '#util';
import type { Request, Response } from 'polka';
import type { ApiPostFiltersUrlsBody } from '@automoderator/core';

@injectable()
export default class PostFiltersUrlRoute extends Route {
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
