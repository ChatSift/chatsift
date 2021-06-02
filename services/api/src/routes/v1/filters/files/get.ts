import { jsonParser, Route, userAuth, permissions, validate } from '@automoderator/rest';
import { inject, injectable } from 'tsyringe';
import * as Joi from 'joi';
import { kSql } from '@automoderator/injection';
import type { Request, Response } from 'polka';
import type { ApiGetFiltersDomainsQuery, MaliciousFile } from '@automoderator/core';
import type { Sql } from 'postgres';

@injectable()
export default class GetFiltersFilesRoute extends Route {
  public override readonly middleware = [
    userAuth(),
    permissions('manageFileFilters'),
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
    @inject(kSql) public readonly sql: Sql<{}>
  ) {
    super();
  }

  public async handle(req: Request, res: Response) {
    const { page } = req.query as unknown as ApiGetFiltersDomainsQuery;

    const files = await this.sql<MaliciousFile[]>`
      SELECT * FROM malicious_files
      LIMIT 100
      OFFSET ${page * 100}
    `;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(files));
  }
}
