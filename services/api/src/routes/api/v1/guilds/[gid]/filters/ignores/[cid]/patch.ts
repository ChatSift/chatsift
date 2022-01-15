import { FilterIgnoresController } from '#controllers';
import type { ApiPatchFiltersIgnoresChannelBody } from '@automoderator/core';
import { FilterIgnores } from '@automoderator/filter-ignores';
import { jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import { badRequest } from '@hapi/boom';
import type { Snowflake } from 'discord-api-types/v9';
import * as Joi from 'joi';
import type { NextHandler, Request, Response } from 'polka';
import { injectable } from 'tsyringe';

@injectable()
export default class PatchGuildsFiltersIgnoresChannelRoute extends Route {
	public override readonly middleware = [
		thirdPartyAuth(),
		jsonParser(),
		validate(
			Joi.object()
				.keys({
					value: Joi.string().required(),
				})
				.required(),
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
