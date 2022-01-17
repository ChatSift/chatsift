import { LocalFiltersController } from '#controllers';
import type { ApiPatchGuildsFiltersLocalBody } from '@automoderator/core';
import type { Snowflake } from 'discord-api-types/v9';
import * as zod from 'zod';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';
import { jsonParser, Route, validate } from '@chatsift/rest-utils';
import { thirdPartyAuth } from '#middleware';

@injectable()
export default class extends Route {
	public override readonly middleware = [
		thirdPartyAuth(),
		jsonParser(),
		validate(
			zod.object({
				word: zod.string(),
				flags: zod.string().default('0'),
				duration: zod.number().nullable().default(null),
			}),
			'body',
		),
	];

	public constructor(public readonly controller: LocalFiltersController) {
		super();
	}

	public async handle(req: Request, res: Response) {
		const { gid } = req.params as { gid: Snowflake };
		const data = req.body as Required<ApiPatchGuildsFiltersLocalBody>;

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		return res.end(JSON.stringify(await this.controller.update(gid, data)));
	}
}
