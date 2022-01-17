import { FilterIgnoresController } from '#controllers';
import type { ApiPatchFiltersIgnoresChannelBody } from '@automoderator/core';
import { FilterIgnores } from '@automoderator/filter-ignores';
import { badRequest } from '@hapi/boom';
import type { Snowflake } from 'discord-api-types/v9';
import * as zod from 'zod';
import type { NextHandler, Request, Response } from 'polka';
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
				value: zod.string(),
			}),
		),
	];

	public constructor(public readonly controller: FilterIgnoresController) {
		super();
	}

	public async handle(req: Request, res: Response, next: NextHandler) {
		const { gid, cid } = req.params as { gid: Snowflake; cid: Snowflake };
		const { value } = req.body as ApiPatchFiltersIgnoresChannelBody;

		try {
			new FilterIgnores(BigInt(value));
		} catch {
			return next(badRequest('Invalid bitfield value'));
		}

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		const ignore = await this.controller.update({ guild_id: gid, channel_id: cid, value });
		return res.end(JSON.stringify(ignore));
	}
}
