import { jsonParser, Route, userAuth, globalPermissions, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { FilesController } from '#controllers';
import type { Request, Response } from 'polka';
import type { ApiGetFiltersFilesBody } from '@automoderator/core';

@injectable()
export default class GetFiltersFilesRoute extends Route {
  public override readonly middleware = [
    userAuth(),
    globalPermissions('manageFileFilters'),
    jsonParser(),
    validate(
      Joi
        .object()
        .keys({
          page: Joi.number()
        })
        .required(),
      'query'
    )
  ];

  public constructor(
    public readonly controller: FilesController
  ) {
    super();
  }

  public async handle(req: Request, res: Response) {
    const { page } = req.query as unknown as ApiGetFiltersFilesBody;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(page == null ? await this.controller.getAll() : await this.controller.get(page)));
  }
}
