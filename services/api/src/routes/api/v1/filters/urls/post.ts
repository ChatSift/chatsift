import { UrlsController } from '#controllers';
import { resolveUrls } from '#util';
import type { ApiPostFiltersUrlsBody } from '@automoderator/core';
import * as zod from 'zod';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';
import { jsonParser, Route, validate } from '@chatsift/rest-utils';
import { globalPermissions, thirdPartyAuth } from '#middleware';

@injectable()
export default class extends Route {
	public override readonly middleware = [
		thirdPartyAuth(),
		globalPermissions('useUrlFilters'),
		jsonParser(),
		validate(
			zod.object({
				urls: zod.string().array(),
			}),
			'body',
		),
	];

	public constructor(public readonly controller: UrlsController) {
		super();
	}

	public async handle(req: Request, res: Response) {
		const { urls } = req.body as ApiPostFiltersUrlsBody;

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		return res.end(JSON.stringify(await this.controller.getHitsFrom([...resolveUrls(urls)])));
	}
}
