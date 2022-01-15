import { UrlsAllowlistController } from '#controllers';
import { Route, thirdPartyAuth } from '@automoderator/rest';
import { conflict } from '@hapi/boom';
import type { Snowflake } from 'discord-api-types/v9';
import type { NextHandler, Request, Response } from 'polka';
import { injectable } from 'tsyringe';

@injectable()
export default class PutGuildsFiltersUrlsAllowlistRoute extends Route {
	public override readonly middleware = [thirdPartyAuth()];

	public constructor(public readonly controller: UrlsAllowlistController) {
		super();
	}

	public async handle(req: Request, res: Response, next: NextHandler) {
		const { gid, domain } = req.params as { gid: Snowflake; domain: string };

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		const ignore = await this.controller.add(gid, domain);

		if (!ignore) {
			return next(conflict('That domain is already on the allowlist'));
		}

		return res.end(JSON.stringify(ignore));
	}
}
