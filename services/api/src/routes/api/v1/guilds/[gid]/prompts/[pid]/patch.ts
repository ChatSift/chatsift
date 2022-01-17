import { PromptsController } from '#controllers';
import type { ApiPatchGuildPromptBody } from '@automoderator/core';
import type { Snowflake } from 'discord-api-types/v9';
import * as zod from 'zod';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';
import { jsonParser, Route, validate } from '@chatsift/rest-utils';
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
		jsonParser(),
		validate(
			zod.object({
				message_id: zod.string().regex(/\d{17,20}/),
				channel_id: zod.string().regex(/\d{17,20}/),
			}),
		),
	];

	public constructor(public readonly controller: PromptsController) {
		super();
	}

	public async handle(req: Request, res: Response) {
		const { gid, pid } = req.params as unknown as { gid: Snowflake; pid: number };
		const { message_id, channel_id } = req.body as ApiPatchGuildPromptBody;

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		const prompt = await this.controller.update({
			guild_id: gid,
			prompt_id: pid,
			message_id,
			channel_id: channel_id,
		});

		return res.end(JSON.stringify(prompt));
	}
}
