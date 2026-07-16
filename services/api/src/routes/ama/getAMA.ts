import { getContext } from '@chatsift/backend-core';
import { internal, notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import type { AMAPromptDataRow, AMASessionRow } from '../../util/amaTypes.js';
import type { PossiblyMissingChannelInfo } from '../../util/channels.js';
import { fetchGuildChannels } from '../../util/channels.js';
import { discordAPIAma } from '../../util/discordAPI.js';
import { queryWithFreshSchema, snowflakeSchema } from '../../util/schemas.js';
import type { GuildChannelInfo } from '../guilds/get.js';
import type { AMASessionWithCount } from './getAMAs.js';

const querySchema = queryWithFreshSchema;
const paramsSchema = z.object({ guildId: snowflakeSchema, amaId: z.coerce.number().int().positive() });

export type GetAMAQuery = z.input<typeof querySchema>;

export interface AMASessionDetailed
	extends Omit<
		AMASessionWithCount,
		'answersChannelId' | 'flaggedQueueId' | 'guestQueueId' | 'modQueueId' | 'promptChannelId'
	> {
	answersChannel: GuildChannelInfo | PossiblyMissingChannelInfo;
	flaggedQueueChannel: GuildChannelInfo | PossiblyMissingChannelInfo | null;
	guestQueueChannel: GuildChannelInfo | PossiblyMissingChannelInfo | null;
	modQueueChannel: GuildChannelInfo | PossiblyMissingChannelInfo | null;
	promptChannel: GuildChannelInfo | PossiblyMissingChannelInfo;
	promptMessageExists: boolean;
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/ama/amas/:amaId',
	schema: {
		query: querySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<AMASessionDetailed> {
		const { guildId, amaId } = req.params;

		const [session] = await getContext().rawDb<AMASessionRow[]>`
			SELECT * FROM ama_sessions WHERE guild_id = ${guildId} AND id = ${amaId}
		`;

		if (!session) {
			throw notFound('ama session not found');
		}

		const [questionCount] = await getContext().rawDb<{ count: string }[]>`
			SELECT COUNT(*) AS count FROM ama_questions WHERE ama_id = ${session.id}
		`;

		const [promptData] = await getContext().rawDb<AMAPromptDataRow[]>`
			SELECT * FROM ama_prompt_data WHERE ama_id = ${session.id}
		`;

		if (!promptData) {
			getContext().logger.warn({ guildId, amaId }, `AMA session ${amaId} in guild ${guildId} is missing prompt data`);
			throw internal();
		}

		const channels = await fetchGuildChannels(guildId, discordAPIAma);
		if (!channels) {
			getContext().logger.warn({ guildId }, `Failed to fetch channels for guild ${guildId}`);
			throw internal();
		}

		const answersChannel = channels.find((c) => c.id === session.answersChannelId) ?? { id: session.answersChannelId };
		const flaggedQueueChannel = session.flaggedQueueId
			? (channels.find((c) => c.id === session.flaggedQueueId) ?? { id: session.flaggedQueueId })
			: null;
		const guestQueueChannel = session.guestQueueId
			? (channels.find((c) => c.id === session.guestQueueId) ?? { id: session.guestQueueId })
			: null;
		const modQueueChannel = session.modQueueId
			? (channels.find((c) => c.id === session.modQueueId) ?? { id: session.modQueueId })
			: null;
		const promptChannel = channels.find((c) => c.id === session.promptChannelId) ?? { id: session.promptChannelId };

		const shouldEndNow = !session.ended && (!answersChannel || !promptChannel);
		if (shouldEndNow) {
			getContext().logger.warn(
				{ guildId, amaId },
				`AMA session ${amaId} in guild ${guildId} has missing critical channels`,
			);
			await getContext().rawDb`UPDATE ama_sessions SET ended = true WHERE id = ${amaId}`;
		}

		let promptMessageExists = false;
		try {
			await discordAPIAma.channels.getMessage(session.promptChannelId, promptData.promptMessageId);
			promptMessageExists = true;
		} catch {
			promptMessageExists = false;
		}

		return {
			...session,
			ended: shouldEndNow ? true : session.ended,
			questionCount: Number(questionCount?.count ?? 0),
			answersChannel,
			flaggedQueueChannel,
			guestQueueChannel,
			modQueueChannel,
			promptChannel,
			promptMessageExists,
		};
	},
});
