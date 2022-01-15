import { AssignablesController } from '#controllers';
import { Route, thirdPartyAuth } from '@automoderator/rest';
import { notFound } from '@hapi/boom';
import type { Snowflake } from 'discord-api-types/v9';
import type { Request, Response, NextHandler } from 'polka';
import { injectable } from 'tsyringe';

@injectable()
export default class GetGuildsAssignablesRolesRoute extends Route {
	public override readonly middleware = [thirdPartyAuth()];

	public constructor(public readonly controller: AssignablesController) {
		super();
	}

	public async handle(req: Request, res: Response, next: NextHandler) {
		const { rid } = req.params as { rid: Snowflake };

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		const assignable = await this.controller.get(rid);

		if (!assignable) {
			return next(notFound('Role not found'));
		}

		return res.end(JSON.stringify(assignable));
	}
}
