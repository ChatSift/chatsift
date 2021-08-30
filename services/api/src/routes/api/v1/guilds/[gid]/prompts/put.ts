import { PromptsController } from '#controllers';
import type { ApiPutGuildPromptsBody } from '@automoderator/core';
import { jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import type { Snowflake } from 'discord-api-types/v9';
import * as Joi from 'joi';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';

@injectable()
export default class PutGuildsPromptsRoute extends Route {
  public override readonly middleware = [
    thirdPartyAuth(),
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
            .required(),
          embed_color: Joi.number().required(),
          embed_title: Joi.string().required(),
          embed_description: Joi.string().allow(null),
          embed_image: Joi.string().allow(null)
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
    const { gid } = req.params as { gid: Snowflake };
    const data = req.body as ApiPutGuildPromptsBody;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    const prompt = await this.controller.add({ guild_id: gid, ...data });

    return res.end(JSON.stringify(prompt));
  }
}
