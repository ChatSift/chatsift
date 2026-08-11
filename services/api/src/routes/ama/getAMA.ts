import { getContext } from '@chatsift/backend-core';
import type { AmaPromptData, AmaSessions, AmaSessionsId } from '@chatsift/db';
import type { APIUser, Snowflake } from '@discordjs/core';
import { internal, notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import type { PossiblyMissingChannelInfo } from '../../util/channels.js';
import { fetchGuildChannels } from '../../util/channels.js';
import { discordAPIAma } from '../../util/discordAPI.js';
import { queryWithFreshSchema, snowflakeSchema } from '../../util/schemas.js';
import type { GuildChannelInfo } from '../guilds/get.js';
import type { AMASessionWithCount } from './getAMAs.js';
import { resolveAmaUser } from './questions/util.js';

const querySchema = queryWithFreshSchema;
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	// Cast to the branded `ama_sessions` id type once, here at the validation boundary, so every raw SQL call site
	// downstream gets a properly-typed id for free instead of needing its own cast against `AmaSessions.id`.
	amaId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as AmaSessionsId),
});

export type GetAMAQuery = z.input<typeof querySchema>;

export interface AMASessionDetailed extends Omit<
	AMASessionWithCount,
	'answersChannelId' | 'promptChannelId' | 'queueId'
> {
	// Null on a public-page-only AMA (#316) -- same shape as `queueChannel` below.
	answersChannel: GuildChannelInfo | PossiblyMissingChannelInfo | null;
	// Resolved `guestIds`, same order -- backs the "answered by" guest pickers in the dashboard's
	// answer editor without every consumer re-resolving raw ids itself.
	guests: (APIUser | Snowflake)[];
	promptChannel: GuildChannelInfo | PossiblyMissingChannelInfo;
	promptJsonData: string;
	promptMessageExists: boolean;
	queueChannel: GuildChannelInfo | PossiblyMissingChannelInfo | null;
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
		isGuildManager: 'or-ama-guest',
	}),
	async handler(req): Promise<AMASessionDetailed> {
		const { guildId, amaId } = req.params;

		const [session] = await getContext().db<AmaSessions[]>`
			SELECT * FROM ama_sessions WHERE guild_id = ${guildId} AND id = ${amaId}
		`;

		if (!session) {
			throw notFound('ama session not found');
		}

		const [questionCount] = await getContext().db<{ count: string }[]>`
			SELECT COUNT(*) AS count FROM ama_questions WHERE ama_id = ${session.id}
		`;

		const [promptData] = await getContext().db<AmaPromptData[]>`
			SELECT * FROM ama_prompt_data WHERE ama_id = ${session.id}
		`;

		if (!promptData) {
			req.logger.warn({ guildId, amaId }, `AMA session ${amaId} in guild ${guildId} is missing prompt data`);
			throw internal();
		}

		const channels = await fetchGuildChannels(guildId, 'AMA', req.query.force_fresh);
		if (!channels) {
			req.logger.warn({ guildId }, `Failed to fetch channels for guild ${guildId}`);
			throw internal();
		}

		const answersChannelId = session.answersChannelId;
		const foundAnswersChannel = answersChannelId ? channels.find((c) => c.id === answersChannelId) : undefined;
		const answersChannel = answersChannelId ? (foundAnswersChannel ?? { id: answersChannelId }) : null;
		const queueChannel = session.queueId
			? (channels.find((c) => c.id === session.queueId) ?? { id: session.queueId })
			: null;
		const foundPromptChannel = channels.find((c) => c.id === session.promptChannelId);
		const promptChannel = foundPromptChannel ?? { id: session.promptChannelId };

		// Check the raw `find(...)` results, not `answersChannel`/`promptChannel` — those always fall back to
		// `{ id }` when not found, so they're never falsy themselves. The answers half is conditional on one
		// being configured at all: a public-page-only AMA (#316) has nothing to go missing, and without the
		// guard every such session would close itself the first time this route ran.
		const shouldEndNow = !session.ended && ((Boolean(answersChannelId) && !foundAnswersChannel) || !foundPromptChannel);
		if (shouldEndNow) {
			req.logger.warn({ guildId, amaId }, `AMA session ${amaId} in guild ${guildId} has missing critical channels`);
			await getContext().db`UPDATE ama_sessions SET ended = true WHERE id = ${amaId}`;
		}

		let promptMessageExists = false;
		try {
			await discordAPIAma.channels.getMessage(session.promptChannelId, promptData.promptMessageId);
			promptMessageExists = true;
		} catch {
			promptMessageExists = false;
		}

		// `resolveAmaUser` only falls back to the bare id on a 404 -- anything else (a rate limit, a
		// transient Discord outage) would otherwise reject this whole request over what's ultimately a
		// minor display detail. Falls back to the raw id here too rather than letting one bad guest lookup
		// take down the entire AMA detail view.
		const guests = await Promise.all(
			session.guestIds.map(async (guestId) => resolveAmaUser(guildId, guestId).catch(() => guestId)),
		);

		return {
			...session,
			ended: shouldEndNow ? true : session.ended,
			questionCount: Number(questionCount?.count ?? 0),
			answersChannel,
			guests,
			promptChannel,
			promptJsonData: promptData.promptJsonData,
			promptMessageExists,
			queueChannel,
		};
	},
});
