import { PromptsController } from '#controllers';
import { Route, thirdPartyAuth, validate } from '@automoderator/rest';
import { notFound } from '@hapi/boom';
import type { Snowflake } from 'discord-api-types/v9';
import * as Joi from 'joi';
import type { Request, Response, NextHandler } from 'polka';
import { injectable } from 'tsyringe';

@injectable()
export default class GetGuildsPromptRoute extends Route {
	public override readonly middleware = [
		thirdPartyAuth(),
		validate(
			Joi.object()
				.keys({
					gid: Joi.string().required(),
					pid: Joi.number().required(),
				})
				.required(),
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
