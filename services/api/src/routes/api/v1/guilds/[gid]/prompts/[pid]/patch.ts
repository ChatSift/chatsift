import { PromptsController } from '#controllers';
import type { ApiPatchGuildPromptBody } from '@automoderator/core';
import { jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import { Snowflake } from 'discord-api-types/v9';
import * as Joi from 'joi';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';

@injectable()
export default class PatchGuildsPromptsRoute extends Route {
  public override readonly middleware = [
    thirdPartyAuth(),
    validate(
      Joi
        .object()
        .keys({
          gid: Joi.string().required(),
          pid: Joi.number().required()
        })
        .required(),
      'params'
    ),
    jsonParser(),
    validate(
      Joi
        .object()
        .keys({
          message_id: Joi.string()
            .pattern(/\d{17,20}/)
            .required(),
          channel_id: Joi.string()
            .pattern(/\d{17,20}/)
            .required()
        })
        .required()
    )
  ];

  public constructor(
    public readonly controller: PromptsController
  ) {
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
      channel_id: channel_id
    });

    return res.end(JSON.stringify(prompt));
  }
}
