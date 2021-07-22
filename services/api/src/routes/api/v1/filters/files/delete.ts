import { jsonParser, Route, userAuth, globalPermissions, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { FilesController } from '#controllers';
import { notFound } from '@hapi/boom';
import type { ApiDeleteFiltersFilesBody } from '@automoderator/core';
import type { Request, Response, NextHandler } from 'polka';

@injectable()
export default class DeleteFiltersFilesRoute extends Route {
  public override readonly middleware = [
    userAuth(),
    globalPermissions('manageFileFilters'),
    jsonParser(),
    validate(
      Joi
        .array()
        .items(Joi.number().required())
        .required(),
      'body'
    )
  ];

  public constructor(
    public readonly controller: FilesController
  ) {
    super();
  }

  public async handle(req: Request, res: Response, next: NextHandler) {
    const files = req.body as ApiDeleteFiltersFilesBody;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    const deletes = await this.controller.delete(files);

    if (!deletes.length) {
      return next(notFound('None of the given hashes could be found'));
    }

    return res.end(JSON.stringify(deletes));
  }
}
