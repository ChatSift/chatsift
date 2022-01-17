import { FilesController } from '#controllers';
import { ApiPutFiltersFilesBody, MaliciousFileCategory } from '@automoderator/core';
import * as zod from 'zod';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';
import { jsonParser, Route, validate } from '@chatsift/rest-utils';
import { globalPermissions, userAuth } from '#middleware';

@injectable()
export default class extends Route {
	public override readonly middleware = [
		userAuth(),
		globalPermissions('manageFileFilters'),
		jsonParser(),
		validate(
			zod.object({
				url: zod.string(),
				category: zod.number().min(MaliciousFileCategory.nsfw).max(MaliciousFileCategory.crasher),
			}),
			'body',
		),
	];

	public constructor(public readonly controller: FilesController) {
		super();
	}

	public async handle(req: Request, res: Response) {
		const files = req.body as ApiPutFiltersFilesBody;

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		return res.end(JSON.stringify(await this.controller.add(files)));
	}
}
