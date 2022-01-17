import { UrlsAllowlistController } from '#controllers';
import { Route } from '@chatsift/rest-utils';
import { conflict } from '@hapi/boom';
import type { Snowflake } from 'discord-api-types/v9';
import type { NextHandler, Request, Response } from 'polka';
import { injectable } from 'tsyringe';
import { thirdPartyAuth } from '#middleware';

@injectable()
export default class extends Route {
	public override readonly middleware = [thirdPartyAuth()];

	public constructor(public readonly controller: UrlsAllowlistController) {
		super();
	}

	public async handle(req: Request, res: Response, next: NextHandler) {
		const { gid, domain } = req.params as { gid: Snowflake; domain: string };

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		const ignore = await this.controller.delete(gid, domain);

		if (!ignore) {
			return next(conflict('That domain was not on the allowlist'));
		}

		return res.end(JSON.stringify(ignore));
	}
}
