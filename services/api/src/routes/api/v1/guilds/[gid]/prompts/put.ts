import { PromptsController } from '#controllers';
import type { ApiPutGuildPromptsBody } from '@automoderator/core';
import type { Snowflake } from 'discord-api-types/v9';
import * as zod from 'zod';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';
import { jsonParser, Route, validate } from '@chatsift/rest-utils';
import { thirdPartyAuth } from '../../../../../../middleware';

@injectable()
export default class extends Route {
	public override readonly middleware = [
		thirdPartyAuth(),
		jsonParser(),
		validate(
			zod.object({
				message_id: zod.string().regex(/\d{17,20}/),
				channel_id: zod.string().regex(/\d{17,20}/),
				embed_color: zod.number(),
				embed_title: zod.string(),
				embed_description: zod.string().nullable(),
				embed_image: zod.string().nullable(),
				use_buttons: zod.boolean().default(false),
			}),
		),
	];

	public constructor(public readonly controller: PromptsController) {
		super();
	}

	public async handle(req: Request, res: Response) {
		const { gid } = req.params as { gid: Snowflake };
		const data = req.body as ApiPutGuildPromptsBody;

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		const prompt = await this.controller.add({ guild_id: gid, ...data });

		return res.end(JSON.stringify(prompt));
	}
}
