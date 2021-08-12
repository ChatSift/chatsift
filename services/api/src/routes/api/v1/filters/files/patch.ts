import { FilesController } from '#controllers';
import { ApiPatchFiltersFilesBody, MaliciousFileCategory } from '@automoderator/core';
import { globalPermissions, jsonParser, Route, userAuth, validate } from '@automoderator/rest';
import { notFound } from '@hapi/boom';
import * as Joi from 'joi';
import type { NextHandler, Request, Response } from 'polka';
import { injectable } from 'tsyringe';

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
