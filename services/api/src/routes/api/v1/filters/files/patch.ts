import { jsonParser, Route, userAuth, globalPermissions, validate } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import * as Joi from 'joi';
import { notFound } from '@hapi/boom';
import { ApiPatchFiltersFilesBody, MaliciousFileCategory } from '@automoderator/core';
import { FilesController } from '#controllers';
import type { Request, Response, NextHandler } from 'polka';

@injectable()
export default class PatchFiltersFilesRoute extends Route {
  public override readonly middleware = [
    userAuth(),
    globalPermissions('manageFileFilters'),
    jsonParser(),
    validate(
      Joi
        .array()
        .items(
          Joi.object()
            .keys({
              file_id: Joi.number().required(),
              category: Joi.number()
                .min(MaliciousFileCategory.nsfw)
                .max(MaliciousFileCategory.crasher)
                .required()
            })
            .required()
        )
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
    const domains = req.body as ApiPatchFiltersFilesBody;

    const result = await this.controller.updateBulk(domains);

    if (!result.success) {
      return next(notFound(result.error));
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(result.value));
  }
}
