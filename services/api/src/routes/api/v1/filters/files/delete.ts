import { jsonParser, Route, userAuth, globalPermissions, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { FilesController } from '#controllers';
import type { ApiDeleteFiltersFilesBody } from '@automoderator/core';
import type { Request, Response } from 'polka';

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

  public async handle(req: Request, res: Response) {
    const files = req.body as ApiDeleteFiltersFilesBody;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(await this.controller.delete(files)));
  }
}
