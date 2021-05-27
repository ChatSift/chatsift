import { jsonParser, Route, thirdPartyAuth, permissions, validate } from '@automoderator/rest';
import { inject, injectable } from 'tsyringe';
import * as Joi from 'joi';
import { kSql } from '@automoderator/injection';
import type { Request, Response } from 'polka';
import type { ApiPostFilesFilterBody, MaliciousDomain } from '@automoderator/core';
import type { Sql } from 'postgres';

@injectable()
export default class PostDomainsFilterRoute extends Route {
  public readonly middleware = [
    thirdPartyAuth(),
    permissions('useDomainFilters'),
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
    @inject(kSql) public readonly sql: Sql<{}>
  ) {
    super();
  }

  public async handle(req: Request, res: Response) {
    const { hashes } = req.body as ApiPostFilesFilterBody;

    const files = await this.sql<Pick<MaliciousDomain, 'domain' | 'category'>[]>`
      SELECT domain, category
      FROM malicious_domains
      WHERE domain = ANY(${this.sql.array(hashes)})
    `;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(files));
  }
}
