import { FilesController } from '#controllers';
import type { ApiGetFiltersFilesBody } from '@automoderator/core';
import { globalPermissions, Route, userAuth, validate } from '@automoderator/rest';
import * as Joi from 'joi';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';

@injectable()
export default class GetFiltersFilesRoute extends Route {
	public override readonly middleware = [
		userAuth(),
		globalPermissions('manageFileFilters'),
		validate(
			Joi.object()
				.keys({
					page: Joi.number(),
				})
				.required(),
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
