import { PromptsController } from '#controllers';
import { Route } from '@chatsift/rest-utils';
import { notFound } from '@hapi/boom';
import type { Snowflake } from 'discord-api-types/v9';
import type { Request, Response, NextHandler } from 'polka';
import { injectable } from 'tsyringe';
import { thirdPartyAuth } from '#middleware';

@injectable()
export default class extends Route {
	public override readonly middleware = [thirdPartyAuth()];

	public constructor(public readonly controller: PromptsController) {
		super();
	}

	public async handle(req: Request, res: Response, next: NextHandler) {
		const { mid } = req.params as { mid: Snowflake };

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		const prompt = await this.controller.getByMessage(mid);

		if (!prompt) {
			return next(notFound('No prompt belonging to that message found'));
		}

		return res.end(JSON.stringify(prompt));
	}
}
