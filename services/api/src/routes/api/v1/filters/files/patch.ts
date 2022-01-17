import { FilesController } from '#controllers';
import { ApiPatchFiltersFilesBody, MaliciousFileCategory } from '@automoderator/core';
import { notFound } from '@hapi/boom';
import * as zod from 'zod';
import type { NextHandler, Request, Response } from 'polka';
import { injectable } from 'tsyringe';
import { jsonParser, Route, validate } from '@chatsift/rest-utils';
import { globalPermissions, userAuth } from '../../../../../middleware';

@injectable()
export default class extends Route {
	public override readonly middleware = [
		userAuth(),
		globalPermissions('manageFileFilters'),
		jsonParser(),
		validate(
			zod.object({
				file_id: zod.number(),
				category: zod.number().min(MaliciousFileCategory.nsfw).max(MaliciousFileCategory.crasher),
			}),
			'body',
		),
	];

	public constructor(public readonly controller: FilesController) {
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
