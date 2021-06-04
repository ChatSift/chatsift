import { jsonParser, Route, thirdPartyAuth, globalPermissions, validate } from '@automoderator/rest';
import { inject, injectable } from 'tsyringe';
import * as Joi from 'joi';
import { kSql } from '@automoderator/injection';
import type { Request, Response } from 'polka';
import type { ApiPostFiltersFilesBody, MaliciousFile } from '@automoderator/core';
import type { Sql } from 'postgres';

@injectable()
export default class PostFiltersFilesRoute extends Route {
  public override readonly middleware = [
    thirdPartyAuth(),
    globalPermissions('useFileFilters'),
    jsonParser(),
    validate(
      Joi
        .object()
        .keys({
          hashes: Joi
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
    const { hashes } = req.body as ApiPostFiltersFilesBody;

    const hits = await this.sql<Pick<MaliciousFile, 'file_hash' | 'category'>[]>`
      SELECT file_hash, category
      FROM malicious_files
      WHERE file_hash = ANY(${this.sql.array(hashes)})
    `;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(hits));
  }
}
