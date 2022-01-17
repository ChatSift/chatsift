import { UrlsController } from '#controllers';
import { ApiPatchFiltersUrlsBody, MaliciousUrlCategory } from '@automoderator/core';
import { notFound } from '@hapi/boom';
import * as zod from 'zod';
import type { NextHandler, Request, Response } from 'polka';
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
					url_id: zod.number(),
					category: zod.number().min(MaliciousUrlCategory.malicious).max(MaliciousUrlCategory.urlShortner),
				})
				.array(),
			'body',
		),
	];

	public constructor(public readonly controller: UrlsController) {
		super();
	}

	public async handle(req: Request, res: Response, next: NextHandler) {
		const domains = req.body as ApiPatchFiltersUrlsBody;

		const result = await this.controller.updateBulk(domains);

		if (!result.success) {
			return next(notFound(result.error));
		}

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		return res.end(JSON.stringify(result.value));
	}
}
