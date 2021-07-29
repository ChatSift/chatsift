import { injectable } from 'tsyringe';
import { jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import { SettingsController } from '#controllers';
import * as Joi from 'joi';
import type { Request, Response } from 'polka';
import type { Snowflake } from 'discord-api-types/v9';
import type { ApiPatchGuildSettingsBody } from '@automoderator/core';

@injectable()
export default class PatchGuildsSettingsRoute extends Route {
  public override readonly middleware = [
    thirdPartyAuth(),
    jsonParser(),
    validate(
      Joi
        .object()
        .keys({
          mod_role: Joi.string()
            .pattern(/\d{17,20}/)
            .allow(null),
          admin_role: Joi.string()
            .pattern(/\d{17,20}/)
            .allow(null),
          mute_role: Joi.string()
            .pattern(/\d{17,20}/)
            .allow(null),
          auto_pardon_mutes_after: Joi.number()
            .min(1)
            .max(365)
            .allow(null),
          use_url_filters: Joi.boolean(),
          use_file_filters: Joi.boolean(),
          use_invite_filters: Joi.boolean(),
          mod_action_log_channel: Joi.string()
            .pattern(/\d{17,20}/)
            .allow(null),
          filter_trigger_log_channel: Joi.string()
            .pattern(/\d{17,20}/)
            .allow(null),
          assignable_roles_prompt: Joi.string().allow(null)
        })
        .required(),
      'body'
    )
  ];

  public constructor(
    public readonly controller: SettingsController
  ) {
    super();
  }

  public async handle(req: Request, res: Response) {
    const { gid } = req.params as { gid: Snowflake };
    const data = req.body as ApiPatchGuildSettingsBody;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    const settings = await this.controller.update(gid, data);
    return res.end(JSON.stringify(settings));
  }
}
