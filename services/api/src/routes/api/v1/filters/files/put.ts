import { jsonParser, Route, userAuth, globalPermissions, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { ApiPutFiltersFilesBody, MaliciousFileCategory } from '@automoderator/core';
import { FilesController } from '#controllers';
import type { Request, Response } from 'polka';

@injectable()
export default class PutFiltersFilesRoute extends Route {
  public override readonly middleware = [
    userAuth(),
    globalPermissions('manageFileFilters'),
    jsonParser(),
    validate(
      Joi
        .object()
        .keys({
          url: Joi.string().required(),
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
    public readonly controller: FilesController
  ) {
    super();
  }

  public async handle(req: Request, res: Response) {
    const files = (req.body as ApiPutFiltersFilesBody).map(file => ({ ...file, admin: req.user!.id }));

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(await this.controller.add(files)));
  }
}
