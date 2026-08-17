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
export type UpdateAutomoderatorConfigResult = Pick<AutomoderatorGuildSettings, 'dryRun' | 'guildId'>;

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

		// Both halves derive from `data`, rather than the insert hard-coding a column list. With one settable
		// field they agreed anyway; with two, a hard-coded insert would silently fall back to the column default
		// for the new field while the update path set it -- a divergence that only shows up on first write.
		// Columns absent from `data` are left to their schema defaults, which is what "not provided" means here.
		// Returns the same narrow shape `getConfig.ts` does -- `last_case_id` is the case-number allocator's
		// bookkeeping and never leaves the server.
		const [settings] = await db<UpdateAutomoderatorConfigResult[]>`
			INSERT INTO automoderator_guild_settings ${db({ guildId, ...data }, 'guildId', ...columns)}
			ON CONFLICT (guild_id) DO UPDATE SET ${db(data, ...columns)}
			RETURNING guild_id, dry_run
		`;

		// The bot reads this per action rather than caching it, so a guild put into dry-run is in dry-run for
		// the very next action rather than after a refresh interval.
		return settings!;
	},
});
