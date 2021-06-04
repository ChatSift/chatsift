import { jsonParser, Route, userAuth, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { getUserGuilds } from '#util';
import { notFound } from '@hapi/boom';
import type { DomainsController } from '#controllers';
import type { Request, Response, NextHandler } from 'polka';
import type { ApiGetFiltersDomainsQuery } from '@automoderator/core';

@injectable()
export default class GetFiltersDomainsGuildRoute extends Route {
  public override readonly middleware = [
    userAuth(),
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

  public async handle(req: Request, res: Response, next: NextHandler) {
    const { gid } = req.params;
    const { page } = req.query as unknown as ApiGetFiltersDomainsQuery;

    const guilds = await getUserGuilds(req, next, true);
    if (!guilds?.length) return;

    const guild = guilds.find(g => g.id === gid);

    if (!guild) {
      return next(notFound('guild not found'));
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(await this.controller.get(page, gid)));
  }
}
