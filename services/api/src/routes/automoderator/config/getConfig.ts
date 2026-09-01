import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorGuildSettings } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export type GetAutomoderatorConfigResult = Pick<
	AutomoderatorGuildSettings,
	| 'antispamAmount'
	| 'antispamTime'
	| 'autoPardonWarnsAfter'
	| 'dryRun'
	| 'guildId'
	| 'reportsChannelId'
	| 'triggerDecayMinutes'
	| 'useInviteFilters'
	| 'useUrlFilters'
>;

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/automoderator/config',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<GetAutomoderatorConfigResult> {
		const { guildId } = req.params;

		const [settings] = await getContext().db<GetAutomoderatorConfigResult[]>`
			SELECT guild_id, dry_run, reports_channel_id, auto_pardon_warns_after, use_url_filters, use_invite_filters,
				antispam_amount, antispam_time, trigger_decay_minutes
			FROM automoderator_guild_settings
			WHERE guild_id = ${guildId}
		`;

		const defaults: GetAutomoderatorConfigResult = {
			guildId: guildId as AutomoderatorGuildSettings['guildId'],
			dryRun: true,
			reportsChannelId: null,
			autoPardonWarnsAfter: null,
			useUrlFilters: false,
			useInviteFilters: false,
			antispamAmount: null,
			antispamTime: null,
			triggerDecayMinutes: null,
		};

		return settings ?? defaults;
	},
});
