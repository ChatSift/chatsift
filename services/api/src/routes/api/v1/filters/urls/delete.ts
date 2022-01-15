import { UrlsController } from '#controllers';
import type { ApiDeleteFiltersUrlsBody } from '@automoderator/core';
import { globalPermissions, jsonParser, Route, userAuth, validate } from '@automoderator/rest';
import { notFound } from '@hapi/boom';
import * as Joi from 'joi';
import type { NextHandler, Request, Response } from 'polka';
import { injectable } from 'tsyringe';

@injectable()
export default class DeleteFiltersUrlsRoute extends Route {
	public override readonly middleware = [
		userAuth(),
		globalPermissions('manageUrlFilters'),
		jsonParser(),
		validate(Joi.array().items(Joi.number().required()).required(), 'body'),
	];

	public constructor(public readonly controller: UrlsController) {
		super();
	}

	public async handle(req: Request, res: Response, next: NextHandler) {
		const domains = req.body as ApiDeleteFiltersUrlsBody;

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		const deletes = await this.controller.delete(domains);

		if (!deletes.length) {
			return next(notFound('None of the given urls could be found'));
		}

		return res.end(JSON.stringify(deletes));
	}
}
