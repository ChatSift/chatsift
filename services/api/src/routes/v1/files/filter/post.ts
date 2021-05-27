import { jsonParser, Route, thirdPartyAuth, permissions, validate } from '@automoderator/rest';
import { inject, injectable } from 'tsyringe';
import * as Joi from 'joi';
import { kSql } from '@automoderator/injection';
import type { Request, Response } from 'polka';
import type { ApiPostFilesFilterBody, MaliciousFile } from '@automoderator/core';
import type { Sql } from 'postgres';

@injectable()
export default class PostFilesFilterRoute extends Route {
  public readonly middleware = [
    thirdPartyAuth(),
    permissions('useFileFilters'),
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
    const { hashes } = req.body as ApiPostFilesFilterBody;

    const files = new Set(
      await this
        .sql<Pick<MaliciousFile, 'file_hash'>[]>`
          SELECT file_hash
          FROM malicious_files
          WHERE file_hash = ANY(${this.sql.array(hashes)})
        `
        .then(rows => rows.map(row => row.file_hash))
    );

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(
      JSON.stringify(
        hashes.filter(hash => files.has(hash))
      )
    );
  }
}
