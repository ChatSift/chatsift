import { SettingsController } from '#controllers';
import type { ApiPatchGuildSettingsBody } from '@automoderator/core';
import type { Snowflake } from 'discord-api-types/v9';
import * as zod from 'zod';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';
import { jsonParser, Route, validate } from '@chatsift/rest-utils';
import { userOrThirdPartyAuth } from '../../../../../../middleware';

@injectable()
export default class extends Route {
	public override readonly middleware = [
		userOrThirdPartyAuth(),
		jsonParser(),
		validate(
			zod.object({
				mod_role: zod
					.string()
					.regex(/\d{17,20}/)
					.nullable(),
				admin_role: zod
					.string()
					.regex(/\d{17,20}/)
					.nullable(),
				mute_role: zod
					.string()
					.regex(/\d{17,20}/)
					.nullable(),
				auto_pardon_warns_after: zod.number().min(1).max(365).nullable(),
				use_url_filters: zod.boolean(),
				use_global_filters: zod.boolean(),
				use_file_filters: zod.boolean(),
				use_invite_filters: zod.boolean(),
				mod_action_log_channel: zod
					.string()
					.regex(/\d{17,20}/)
					.nullable(),
				filter_trigger_log_channel: zod
					.string()
					.regex(/\d{17,20}/)
					.nullable(),
				user_update_log_channel: zod
					.string()
					.regex(/\d{17,20}/)
					.nullable(),
				message_update_log_channel: zod
					.string()
					.regex(/\d{17,20}/)
					.nullable(),
				assignable_roles_prompt: zod.string().nullable(),
				min_join_age: zod.number().nullable(),
				no_blank_avatar: zod.boolean(),
				reports_channel: zod
					.string()
					.regex(/\d{17,20}/)
					.nullable(),
				antispam_amount: zod.number().nullable(),
				antispam_time: zod.number().nullable(),
				mention_limit: zod.number().nullable(),
				mention_amount: zod.number().nullable(),
				mention_time: zod.number().nullable(),
				automod_cooldown: zod.number().nullable(),
				hentai_threshold: zod.number().min(0).max(100).nullable(),
				porn_threshold: zod.number().min(0).max(100).nullable(),
				sexy_threshold: zod.number().min(0).max(100).nullable(),
			}),
			'body',
		),
	];

	public constructor(public readonly controller: SettingsController) {
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
