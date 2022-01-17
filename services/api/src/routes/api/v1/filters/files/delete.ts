import { FilesController } from '#controllers';
import type { ApiDeleteFiltersFilesBody } from '@automoderator/core';
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
		globalPermissions('manageFileFilters'),
		jsonParser(),
		validate(zod.number().array(), 'body'),
	];

	public constructor(public readonly controller: FilesController) {
		super();
	}

	public async handle(req: Request, res: Response, next: NextHandler) {
		const files = req.body as ApiDeleteFiltersFilesBody;

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		const deletes = await this.controller.delete(files);

		if (!deletes.length) {
			return next(notFound('None of the given hashes could be found'));
		}

		return res.end(JSON.stringify(deletes));
	}
}
