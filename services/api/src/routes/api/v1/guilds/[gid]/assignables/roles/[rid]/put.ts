import { AssignablesController, PromptsController } from '#controllers';
import type { ApiPutGuildsAssignablesRoleBody } from '@automoderator/core';
import { jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import { conflict, notFound } from '@hapi/boom';
import type { Snowflake } from 'discord-api-types/v9';
import * as Joi from 'joi';
import type { NextHandler, Request, Response } from 'polka';
import { injectable } from 'tsyringe';

@injectable()
export default class PutGuildsAssignablesRoleRoute extends Route {
  public override readonly middleware = [
    thirdPartyAuth(),
    jsonParser(),
    validate(
      Joi
        .object()
        .keys({
          prompt_id: Joi.number().required()
        })
        .required()
    )
  ];

  public constructor(
    public readonly controller: AssignablesController,
    public readonly prompts: PromptsController
  ) {
    super();
  }

  public async handle(req: Request, res: Response, next: NextHandler) {
    const { gid, rid } = req.params as { gid: Snowflake; rid: Snowflake };
    const { prompt_id } = req.body as ApiPutGuildsAssignablesRoleBody;

    const existing = await this.controller.getAllForPrompt(prompt_id);

    if (!await this.prompts.get(prompt_id)) {
      return next(notFound('Could not find that prompt'));
    }

    if (existing.length >= 25) {
      return next(conflict('There are already 25 self assignable roles attached to that prompt'));
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    const assignable = await this.controller.add(gid, prompt_id, rid);

    if (!assignable) {
      return next(conflict('That role is already on the list'));
    }

    return res.end(JSON.stringify(assignable));
  }
}
