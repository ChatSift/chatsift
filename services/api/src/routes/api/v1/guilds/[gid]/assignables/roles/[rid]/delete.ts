import { AssignablesController } from '#controllers';
import { Route } from '@chatsift/rest-utils';
import { notFound } from '@hapi/boom';
import type { Snowflake } from 'discord-api-types/v9';
import type { NextHandler, Request, Response } from 'polka';
import { injectable } from 'tsyringe';
import { thirdPartyAuth } from '#middleware';

@injectable()
export default class extends Route {
	public override readonly middleware = [thirdPartyAuth()];

	public constructor(public readonly controller: AssignablesController) {
		super();
	}

	public async handle(req: Request, res: Response, next: NextHandler) {
		const { rid } = req.params as { rid: Snowflake };

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		const assignable = await this.controller.delete(rid);

		if (!assignable) {
			return next(notFound('There was no self assignable role to delete'));
		}

		return res.end(JSON.stringify(assignable));
	}
}
