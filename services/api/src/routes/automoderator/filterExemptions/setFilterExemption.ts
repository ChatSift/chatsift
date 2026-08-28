import { getContext } from '@chatsift/backend-core';
import { automoderatorFilterExemptionsChannel, FILTER_EXEMPTION_MAX_COUNT } from '@chatsift/core';
import { badRequest } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { assertChannelsBelongToGuild } from '../../../util/channels.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { setFilterExemptionBodySchema } from '../schemas.js';
import type { FilterExemption } from './listFilterExemptions.js';

const bodySchema = setFilterExemptionBodySchema;
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	channelId: snowflakeSchema,
});

export type SetFilterExemptionBody = z.input<typeof bodySchema>;
export type SetFilterExemptionResult = FilterExemption;

/**
 * Sets which filters a channel is exempt from (P5b, feature 09), replacing whatever was there.
 *
 * Declarative rather than a per-filter add/remove pair: the editor's mental model is a row of toggles, and a
 * delta API forces the client to diff two states it can only have one of. The replacement is done inside a
 * transaction so a channel is never briefly exempt from nothing -- a delete followed by an insert would leave
 * a window where the runners act in a channel the guild has exempted.
 */
export default defineRoute({
	method: 'put',
	path: '/v3/guilds/:guildId/automoderator/filter-exemptions/:channelId',
	schema: { body: bodySchema, params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorFilterExemptionsChannel(req.params.guildId),
	async handler(req): Promise<SetFilterExemptionResult> {
		const { guildId, channelId } = req.params;
		const context = getContext();
		// Deduplicated because the array shape lets a client send `['URLS', 'URLS']`, which would otherwise be
		// two conflicting inserts in one statement.
		const filters = [...new Set(req.body.filters)];

		// Same reasoning as the log-exemption route's: the bot's REST client spans every guild it is in, so
		// without this a manager could park another server's channel id in their own exemption list, where it
		// would sit unresolvable and indistinguishable from a channel that was deleted.
		await assertChannelsBelongToGuild(guildId, [channelId], 'AUTOMODERATOR', context.logger);

		await context.db.begin(async (tx) => {
			// The cap counts *channels*, not rows -- a channel exempt from both filters is one entry in the
			// editor and should cost one. Checked before the write rather than folded into it: the replacement
			// below is a delete plus an insert, so there is no single statement for a `WHERE` to ride on, and
			// this cap is a bound on how much the bot reads rather than an invariant (see
			// `logExemptions/setLogExemption.ts` for why that distinction is deliberate).
			const [existing] = await tx<{ count: string }[]>`
				SELECT count(DISTINCT channel_id) FROM automoderator_filter_exemptions
				WHERE guild_id = ${guildId} AND channel_id <> ${channelId}
			`;

			if (Number(existing!.count) >= FILTER_EXEMPTION_MAX_COUNT) {
				throw badRequest(`a server can exempt at most ${FILTER_EXEMPTION_MAX_COUNT} channels from filters`);
			}

			await tx`
				DELETE FROM automoderator_filter_exemptions
				WHERE guild_id = ${guildId} AND channel_id = ${channelId}
			`;

			await tx`
				INSERT INTO automoderator_filter_exemptions ${tx(
					filters.map((filter) => ({ guildId, channelId, filter })),
					'guildId',
					'channelId',
					'filter',
				)}
			`;
		});

		return { channelId, filters };
	},
});
