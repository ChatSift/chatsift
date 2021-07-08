import { jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { ApiPutFiltersUrlsGuildBody, MaliciousUrlCategory } from '@automoderator/core';
import { UrlsController } from '#controllers';
import type { Request, Response } from 'polka';

@injectable()
export default class PutFiltersUrlsGuildRoute extends Route {
  public override readonly middleware = [
    thirdPartyAuth(),
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
    const { gid } = req.params;
    const { url } = req.body as ApiPutFiltersUrlsGuildBody;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(await this.controller.add(url, { guild: gid! })));
  }
}
