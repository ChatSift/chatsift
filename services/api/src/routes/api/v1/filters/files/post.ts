import { FilesController } from '#controllers';
import type { ApiPostFiltersFilesBody } from '@automoderator/core';
import * as zod from 'zod';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';
import { jsonParser, Route, validate } from '@chatsift/rest-utils';
import { globalPermissions, thirdPartyAuth } from '#middleware';

@injectable()
export default class extends Route {
	public override readonly middleware = [
		thirdPartyAuth(),
		globalPermissions('useFileFilters'),
		jsonParser(),
		validate(
			zod.object({
				hashes: zod.string().array(),
			}),
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
