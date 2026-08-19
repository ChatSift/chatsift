import { getContext } from '@chatsift/backend-core';
import { automoderatorLogExemptionsChannel, LOG_EXEMPTION_MAX_COUNT } from '@chatsift/core';
import type { AutomoderatorLogExemptions } from '@chatsift/db';
import { badRequest } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { assertChannelsBelongToGuild } from '../../../util/channels.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import type { LogExemption } from './listLogExemptions.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	channelId: snowflakeSchema,
});

export type SetLogExemptionResult = LogExemption;

export default defineRoute({
	method: 'put',
	path: '/v3/guilds/:guildId/automoderator/log-exemptions/:channelId',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorLogExemptionsChannel(req.params.guildId),
	async handler(req): Promise<SetLogExemptionResult> {
		const { guildId, channelId } = req.params;
		const context = getContext();

		// Same reasoning as the log-channel route's: the bot's REST client spans every guild it is in, so
		// without this a manager could park another server's channel id in their own exemption list. It would
		// never match anything, but it would sit in the list unresolvable and indistinguishable from a channel
		// that was deleted.
		await assertChannelsBelongToGuild(guildId, [channelId], 'AUTOMODERATOR', context.logger);

		// The cap is enforced *inside* the insert, the same shape `reportPresets/createPreset.ts` uses -- it
		// closes the window between reading the count and writing the row down to one statement instead of one
		// network round trip. It is deliberately not proof against concurrency: under READ COMMITTED two
		// transactions still both see the pre-insert count, and a burst of simultaneous adds can land a guild a
		// few rows over. That is accepted rather than locked against, because this cap exists to bound how much
		// the bot reads per logged edit, not to hold an invariant -- 103 exemptions costs nothing that 100 does
		// not, and the one real caller disables its button while a write is in flight.
		//
		// The count excludes this channel so re-adding one already exempt stays possible at the cap -- and
		// `DO UPDATE` (setting the key to the value it already holds) exists purely so `RETURNING` still yields
		// a row in that case. Without it, "already exempt" and "over the cap" would both come back empty and
		// this could not tell them apart.
		const [row] = await context.db<Pick<AutomoderatorLogExemptions, 'channelId'>[]>`
			INSERT INTO automoderator_log_exemptions (guild_id, channel_id)
			SELECT ${guildId}, ${channelId}
			WHERE (
				SELECT count(*) FROM automoderator_log_exemptions
				WHERE guild_id = ${guildId} AND channel_id <> ${channelId}
			) < ${LOG_EXEMPTION_MAX_COUNT}
			ON CONFLICT (guild_id, channel_id) DO UPDATE SET channel_id = EXCLUDED.channel_id
			RETURNING channel_id
		`;

		// No row means the `WHERE` above rejected it, which can only be the cap.
		if (!row) {
			throw badRequest(`a server can exempt at most ${LOG_EXEMPTION_MAX_COUNT} channels`);
		}

		return { channelId };
	},
});
