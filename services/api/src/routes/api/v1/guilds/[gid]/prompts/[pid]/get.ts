import { PromptsController } from '#controllers';
import { notFound } from '@hapi/boom';
import type { Snowflake } from 'discord-api-types/v9';
import * as zod from 'zod';
import type { Request, Response, NextHandler } from 'polka';
import { injectable } from 'tsyringe';
import { Route, validate } from '@chatsift/rest-utils';
import { thirdPartyAuth } from '../../../../../../../middleware';

@injectable()
export default class extends Route {
	public override readonly middleware = [
		thirdPartyAuth(),
		validate(
			zod.object({
				gid: zod.string(),
				pid: zod.number(),
			}),
			'params',
		),
	];

	public constructor(public readonly controller: PromptsController) {
		super();
	}

	public async handle(req: Request, res: Response, next: NextHandler) {
		const { gid, pid } = req.params as unknown as { gid: Snowflake; pid: number };

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		const prompt = await this.controller.get(gid, pid);

		if (!prompt) {
			return next(notFound('Prompt not found'));
		}

		return res.end(JSON.stringify(prompt));
	}
}
