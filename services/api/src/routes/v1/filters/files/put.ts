import { jsonParser, Route, userAuth, globalPermissions, validate } from '@automoderator/rest';
import { inject, injectable } from 'tsyringe';
import * as Joi from 'joi';
import { kSql } from '@automoderator/injection';
import { ApiPutFiltersFilesBody, MaliciousFile, MaliciousFileCategory } from '@automoderator/core';
import type { Request, Response } from 'polka';
import type { Sql } from 'postgres';

@injectable()
export default class PutFilesFilesRoute extends Route {
  public override readonly middleware = [
    userAuth(),
    globalPermissions('manageFileFilters'),
    jsonParser(),
    validate(
      Joi
        .object()
        .keys({
          hash: Joi.string().required(),
          category: Joi.number()
            .min(MaliciousFileCategory.nsfw)
            .max(MaliciousFileCategory.crasher)
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
    const { hash, category } = req.body as ApiPutFiltersFilesBody;

    const [data] = await this.sql<[MaliciousFile]>`
      INSERT INTO malicious_domains (file_hash, admin_id, category)
      VALUES (${hash}, ${req.user!.id}, ${category})
      ON CONFLICT (domain)
      DO
        UPDATE SET category = ${category}, last_modified_at = NOW()
        RETURNING *
    `;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(data));
  }
}
