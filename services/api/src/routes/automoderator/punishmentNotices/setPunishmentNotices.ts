import { getContext } from '@chatsift/backend-core';
import { automoderatorPunishmentNoticesChannel } from '@chatsift/core';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { readAppealLink } from '../../../util/appealLink.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { setPunishmentNoticesBodySchema } from '../schemas.js';
import type { GetPunishmentNoticesResult } from './getPunishmentNotices.js';

const bodySchema = setPunishmentNoticesBodySchema;
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type SetPunishmentNoticesBody = z.input<typeof bodySchema>;
export type SetPunishmentNoticesResult = GetPunishmentNoticesResult;

/**
 * Replaces every punishment notice a guild has (#232 P3b) with the set in the body.
 *
 * Declarative, for the reasons on `setPunishmentNoticesBodySchema`. The delete and the insert share one
 * transaction so a guild is never briefly running with no notices at all -- the window between them is exactly
 * when a ban DM would go out missing the appeal link the guild put there.
 */
export default defineRoute({
	method: 'put',
	path: '/v3/guilds/:guildId/automoderator/punishment-notices',
	schema: { body: bodySchema, params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorPunishmentNoticesChannel(req.params.guildId),
	async handler(req): Promise<SetPunishmentNoticesResult> {
		const { guildId } = req.params;
		const { notices } = req.body;

		await getContext().db.begin(async (tx) => {
			await tx`DELETE FROM automoderator_punishment_notices WHERE guild_id = ${guildId}`;

			if (notices.length > 0) {
				await tx`
					INSERT INTO automoderator_punishment_notices ${tx(
						notices.map((notice) => ({ guildId, scope: notice.scope, content: notice.content })),
						'guildId',
						'scope',
						'content',
					)}
				`;
			}
		});

		// Read back rather than echoed from `notices`: `appealLink` is not in the request at all, and the
		// dashboard writes this response straight into the cache the GET fills.
		return { notices, appealLink: await readAppealLink(guildId) };
	},
});
