import { LocalFiltersController } from '#controllers';
import type { ApiGetGuildsFiltersLocalQuery } from '@automoderator/core';
import type { Snowflake } from 'discord-api-types/v9';
import * as zod from 'zod';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';
import { Route, validate } from '@chatsift/rest-utils';
import { thirdPartyAuth } from '#middleware';

@injectable()
export default class extends Route {
	public override readonly middleware = [
		thirdPartyAuth(),
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

	public constructor(public readonly controller: LocalFiltersController) {
		super();
	}

	public async handle(req: Request, res: Response) {
		const { gid } = req.params as { gid: Snowflake };
		const { page } = req.query as unknown as ApiGetGuildsFiltersLocalQuery;

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		return res.end(
			JSON.stringify(page == null ? await this.controller.getAll(gid) : await this.controller.get(gid, page)),
		);
	}
}
