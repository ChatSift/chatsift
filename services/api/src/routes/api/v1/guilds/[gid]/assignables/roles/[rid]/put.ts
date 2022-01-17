import { AssignablesController, PromptsController } from '#controllers';
import type { ApiPutGuildsAssignablesRoleBody } from '@automoderator/core';
import { conflict, notFound } from '@hapi/boom';
import type { Snowflake } from 'discord-api-types/v9';
import * as zod from 'zod';
import type { NextHandler, Request, Response } from 'polka';
import { injectable } from 'tsyringe';
import { jsonParser, Route, validate } from '@chatsift/rest-utils';
import { thirdPartyAuth } from '#middleware';

@injectable()
export default class extends Route {
	public override readonly middleware = [
		thirdPartyAuth(),
		jsonParser(),
		validate(
			zod.object({
				prompt_id: zod.number(),
				emoji: zod
					.object({
						id: zod.string().regex(/\d{17,20}/),
						name: zod.string(),
						animated: zod.boolean().default(false).optional(),
					})
					.optional(),
			}),
		),
	];

	public constructor(public readonly controller: AssignablesController, public readonly prompts: PromptsController) {
		super();
	}

	public async handle(req: Request, res: Response, next: NextHandler) {
		const { gid, rid } = req.params as { gid: Snowflake; rid: Snowflake };
		const { prompt_id, emoji } = req.body as ApiPutGuildsAssignablesRoleBody;

		const existing = await this.controller.getAllForPrompt(prompt_id);

		if (!(await this.prompts.get(gid, prompt_id))) {
			return next(notFound('Could not find that prompt'));
		}

		if (existing.length >= 25) {
			return next(conflict('There are already 25 self assignable roles attached to that prompt'));
		}

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		const assignable = emoji
			? await this.controller.add(gid, prompt_id, rid, emoji)
			: await this.controller.add(gid, prompt_id, rid);

		if (!assignable) {
			const assignables = await this.controller.getAllForPrompt(prompt_id);
			return next(
				conflict(
					assignables.find((a) => a.role_id === rid)
						? 'This role is already assigned to another list'
						: 'That role is already assigned for this prompt',
				),
			);
		}

		return res.end(JSON.stringify(assignable));
	}
}
