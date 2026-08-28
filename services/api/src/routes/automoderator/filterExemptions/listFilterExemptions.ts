import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorFilterExemptions } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import type { WritableFilterKind } from '../schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

/**
 * One exempt channel and every filter it is exempt from.
 *
 * Grouped per channel rather than returned as the flat `(channel, filter)` rows the table holds, because the
 * editor is one row per channel with a toggle per filter -- and regrouping the same set client-side in three
 * different components is how the two representations drift apart.
 */
export interface FilterExemption {
	readonly channelId: string;
	readonly filters: WritableFilterKind[];
}

export type ListFilterExemptionsResult = FilterExemption[];

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/automoderator/filter-exemptions',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<ListFilterExemptionsResult> {
		const rows = await getContext().db<Pick<AutomoderatorFilterExemptions, 'channelId' | 'filter'>[]>`
			SELECT channel_id, filter FROM automoderator_filter_exemptions
			WHERE guild_id = ${req.params.guildId}
			ORDER BY channel_id ASC, filter ASC
		`;

		const grouped = new Map<string, WritableFilterKind[]>();

		for (const row of rows) {
			// `.toString()` because kanel brands primary-key columns.
			const channelId = row.channelId.toString();
			const filters = grouped.get(channelId) ?? [];
			// `ANTISPAM` rows cannot exist yet -- nothing writes one -- but the cast is what would carry one
			// through untouched rather than dropping it silently if P5c lands the runner before this widens.
			filters.push(row.filter as unknown as WritableFilterKind);
			grouped.set(channelId, filters);
		}

		return [...grouped].map(([channelId, filters]) => ({ channelId, filters }));
	},
});
