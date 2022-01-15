import { InvitesAllowlistController } from '#controllers';
import { Route, thirdPartyAuth } from '@automoderator/rest';
import { notFound } from '@hapi/boom';
import type { Snowflake } from 'discord-api-types/v9';
import type { NextHandler, Request, Response } from 'polka';
import { injectable } from 'tsyringe';

@injectable()
export default class DeleteGuildsFiltersInvitesAllowlistRoute extends Route {
	public override readonly middleware = [thirdPartyAuth()];

	public constructor(public readonly controller: InvitesAllowlistController) {
		super();
	}

	public async handle(req: Request, res: Response, next: NextHandler) {
		const { gid } = req.params as { gid: Snowflake };

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		const ignores = await this.controller.deleteAll(gid);

		if (!ignores.length) {
			return next(notFound('There were no allowlist entries to delete'));
		}

		return res.end(JSON.stringify(ignores));
	}
}
