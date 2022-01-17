import { FilesController } from '#controllers';
import type { ApiGetFiltersFilesBody } from '@automoderator/core';
import * as zod from 'zod';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';
import { Route, validate } from '@chatsift/rest-utils';
import { globalPermissions, userAuth } from '#middleware';

@injectable()
export default class extends Route {
	public override readonly middleware = [
		userAuth(),
		globalPermissions('manageFileFilters'),
		validate(
			zod.object({
				page: zod.number(),
			}),
			'query',
		),
	];

	public constructor(public readonly controller: FilesController) {
		super();
	}

	public async handle(req: Request, res: Response) {
		const { page } = req.query as unknown as ApiGetFiltersFilesBody;

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		return res.end(JSON.stringify(page == null ? await this.controller.getAll() : await this.controller.get(page)));
	}
}
