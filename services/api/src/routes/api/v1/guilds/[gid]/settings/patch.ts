import { SettingsController } from '#controllers';
import type { ApiPatchGuildSettingsBody } from '@automoderator/core';
import { jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import type { Snowflake } from 'discord-api-types/v9';
import * as Joi from 'joi';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';

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
          user_update_log_channel: Joi.string()
            .pattern(/\d{17,20}/)
            .allow(null),
          message_update_log_channel: Joi.string()
            .pattern(/\d{17,20}/)
            .allow(null),
          assignable_roles_prompt: Joi.string().allow(null),
          min_join_age: Joi.number().allow(null),
          no_blank_avatar: Joi.boolean()
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
