import { getContext } from '@chatsift/backend-core';
import { automoderatorConfigChannel } from '@chatsift/core';
import type { AutomoderatorGuildSettings } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { updateAutomoderatorConfigBodySchema } from '../schemas.js';

const bodySchema = updateAutomoderatorConfigBodySchema;
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type UpdateAutomoderatorConfigBody = z.input<typeof bodySchema>;
export type UpdateAutomoderatorConfigResult = AutomoderatorGuildSettings;

export default defineRoute({
	method: 'patch',
	path: '/v3/guilds/:guildId/automoderator/config',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	realtimeChannel: (req) => automoderatorConfigChannel(req.params.guildId),
	async handler(req): Promise<UpdateAutomoderatorConfigResult> {
		const data = req.body;
		const { guildId } = req.params;
		const db = getContext().db;

		const columns = Object.keys(data) as (keyof typeof data)[];

		const [settings] = await db<AutomoderatorGuildSettings[]>`
			INSERT INTO automoderator_guild_settings (guild_id, dry_run)
			VALUES (${guildId}, ${data.dryRun ?? true})
			ON CONFLICT (guild_id) DO UPDATE SET ${db(data, ...columns)}
			RETURNING *
		`;

		// The bot reads this per action rather than caching it, so a guild put into dry-run is in dry-run for
		// the very next action rather than after a refresh interval.
		return settings!;
	},
});
