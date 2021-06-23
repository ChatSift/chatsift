import { jsonParser, Route, thirdPartyAuth, globalPermissions, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import type { Request, Response } from 'polka';
import type { ApiPostFiltersUrlsBody } from '@automoderator/core';
import type { UrlsController } from '#controllers';

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
    const { urls: urlsRaw } = req.body as ApiPostFiltersUrlsBody;

    // We make use of a set as it is the cleanest and fastest way to remove duplication from the domain checking
    const urls = new Set(urlsRaw);

    for (const url of urlsRaw) {
      // Not dealing with something that contains a path
      if (!url.includes('/')) {
        continue;
      }

      // Assume that the URL is formatted correctly. Extract the domain
      urls.add(url.split('/')[0]!);
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(await this.controller.getHitsFrom([...urls])));
  }
}
