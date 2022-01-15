import { FilesController } from '#controllers';
import type { ApiPostFiltersFilesBody } from '@automoderator/core';
import { globalPermissions, jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import * as Joi from 'joi';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';

@injectable()
export default class PostFiltersFilesRoute extends Route {
	public override readonly middleware = [
		thirdPartyAuth(),
		globalPermissions('useFileFilters'),
		jsonParser(),
		validate(
			Joi.object()
				.keys({
					hashes: Joi.array().items(Joi.string().required()).required(),
				})
				.required(),
			'body',
		),
	];

	public constructor(public readonly controller: FilesController) {
		super();
	}

	public async handle(req: Request, res: Response) {
		const { hashes } = req.body as ApiPostFiltersFilesBody;

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		return res.end(JSON.stringify(await this.controller.getHitsFrom(hashes)));
	}
}
