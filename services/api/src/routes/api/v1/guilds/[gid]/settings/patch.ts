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
					.optional()
					.nullable(),
				admin_role: zod
					.string()
					.regex(/\d{17,20}/)
					.optional()
					.nullable(),
				mute_role: zod
					.string()
					.regex(/\d{17,20}/)
					.optional()
					.nullable(),
				auto_pardon_warns_after: zod.number().min(1).max(365).optional().nullable(),
				use_url_filters: zod.boolean().optional(),
				use_global_filters: zod.boolean().optional(),
				use_file_filters: zod.boolean().optional(),
				use_invite_filters: zod.boolean().optional(),
				mod_action_log_channel: zod
					.string()
					.regex(/\d{17,20}/)
					.optional()
					.nullable(),
				filter_trigger_log_channel: zod
					.string()
					.regex(/\d{17,20}/)
					.optional()
					.nullable(),
				user_update_log_channel: zod
					.string()
					.regex(/\d{17,20}/)
					.optional()
					.nullable(),
				message_update_log_channel: zod
					.string()
					.regex(/\d{17,20}/)
					.optional()
					.nullable(),
				assignable_roles_prompt: zod.string().optional().nullable(),
				min_join_age: zod.number().optional().nullable(),
				no_blank_avatar: zod.boolean().optional(),
				reports_channel: zod
					.string()
					.regex(/\d{17,20}/)
					.optional()
					.nullable(),
				antispam_amount: zod.number().optional().nullable(),
				antispam_time: zod.number().optional().nullable(),
				mention_limit: zod.number().optional().nullable(),
				mention_amount: zod.number().optional().nullable(),
				mention_time: zod.number().optional().nullable(),
				automod_cooldown: zod.number().optional().nullable(),
				hentai_threshold: zod.number().min(0).max(100).optional().nullable(),
				porn_threshold: zod.number().min(0).max(100).optional().nullable(),
				sexy_threshold: zod.number().min(0).max(100).optional().nullable(),
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
