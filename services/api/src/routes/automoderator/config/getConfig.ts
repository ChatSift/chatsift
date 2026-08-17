import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorGuildSettings } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export type GetAutomoderatorConfigResult = Pick<AutomoderatorGuildSettings, 'dryRun' | 'guildId' | 'reportsChannelId'>;

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
			SELECT guild_id, dry_run, reports_channel_id
			FROM automoderator_guild_settings
			WHERE guild_id = ${guildId}
		`;

		// No row yet is the common case, and it's returned as the shape a fresh row would have rather than a
		// 404 -- same as modmail's and social's `getConfig.ts`, so the config screen renders on first load.
		// `dryRun: true` mirrors the column default, so the form shows what the bot would actually do.
		const defaults: GetAutomoderatorConfigResult = {
			guildId: guildId as AutomoderatorGuildSettings['guildId'],
			dryRun: true,
			reportsChannelId: null,
		};

		return settings ?? defaults;
	},
});
