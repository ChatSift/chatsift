import { UrlsController } from '#controllers';
import type { ApiGetFiltersUrlsQuery } from '@automoderator/core';
import * as zod from 'zod';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';
import { globalPermissions, userAuth } from '#middleware';
import { Route, validate } from '@chatsift/rest-utils';

@injectable()
export default class extends Route {
	public override readonly middleware = [
		userAuth(),
		globalPermissions('manageUrlFilters'),
		validate(
			zod.object({
				page: zod
					.string()
					.refine((value) => !isNaN(Number(value)))
					.transform((value) => Number(value)),
			}),
			'query',
		),
	];

	public constructor(public readonly controller: UrlsController) {
		super();
	}

	public async handle(req: Request, res: Response) {
		const { page } = req.query as unknown as ApiGetFiltersUrlsQuery;

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		return res.end(JSON.stringify(page == null ? await this.controller.getAll() : await this.controller.get(page)));
	}
}
