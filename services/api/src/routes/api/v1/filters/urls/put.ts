import { UrlsController } from '#controllers';
import { ApiPutFiltersUrlsBody, MaliciousUrlCategory } from '@automoderator/core';
import * as zod from 'zod';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';
import { jsonParser, Route, validate } from '@chatsift/rest-utils';
import { globalPermissions, userAuth } from '#middleware';

@injectable()
export default class extends Route {
	public override readonly middleware = [
		userAuth(),
		globalPermissions('manageUrlFilters'),
		jsonParser(),
		validate(
			zod
				.object({
					url: zod.string(),
					category: zod.number().min(MaliciousUrlCategory.malicious).max(MaliciousUrlCategory.urlShortner),
				})
				.array(),
			'body',
		),
	];

	public constructor(public readonly controller: UrlsController) {
		super();
	}

	public async handle(req: Request, res: Response) {
		const domains = req.body as ApiPutFiltersUrlsBody;

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		return res.end(JSON.stringify(await this.controller.add(domains)));
	}
}
