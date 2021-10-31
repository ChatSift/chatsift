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
          auto_pardon_warns_after: Joi.number()
            .min(1)
            .max(365)
            .allow(null),
          use_url_filters: Joi.boolean(),
          use_global_filters: Joi.boolean(),
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
          no_blank_avatar: Joi.boolean(),
          reports_channel: Joi.string()
            .pattern(/\d{17,20}/)
            .allow(null),
          antispam_amount: Joi.number().allow(null),
          antispam_time: Joi.number().allow(null),
          mention_limit: Joi.number().allow(null),
          mention_amount: Joi.number().allow(null),
          mention_time: Joi.number().allow(null),
          automod_cooldown: Joi.number().allow(null),
          hentai_threshold: Joi.number().allow(null)
            .min(0)
            .max(1),
          porn_threshold: Joi.number().allow(null)
            .min(0)
            .max(1),
          sexy_threshold: Joi.number().allow(null)
            .min(0)
            .max(1)
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
