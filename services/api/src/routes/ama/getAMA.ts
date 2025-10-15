import { getContext } from '@chatsift/backend-core';
import { internal, notFound } from '@hapi/boom';
import type { NextHandler, Response } from 'polka';
import type { z } from 'zod';
import { isAuthed } from '../../middleware/isAuthed.js';
import type { PossiblyMissingChannelInfo } from '../../util/channels.js';
import { fetchGuildChannels } from '../../util/channels.js';
import { discordAPIAma } from '../../util/discordAPI.js';
import { queryWithFreshSchema } from '../../util/schemas.js';
import type { GuildChannelInfo } from '../guilds/get.js';
import type { TRequest } from '../route.js';
import { Route, RouteMethod } from '../route.js';
import type { AMASessionWithCount } from './getAMAs.js';

const querySchema = queryWithFreshSchema;
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

export default class GetAMA extends Route<AMASessionDetailed, typeof querySchema> {
	public readonly info = {
		method: RouteMethod.get,
		path: '/v3/guilds/:guildId/ama/amas/:amaId',
	} as const;

	public override readonly queryValidationSchema = querySchema;

	public override readonly middleware = [
		...isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	];

	public override async handle(req: TRequest<typeof querySchema>, res: Response, next: NextHandler) {
		const { guildId, amaId } = req.params as { amaId: string; guildId: string };

		const session = await getContext()
			.db.selectFrom('AMASession')
			.selectAll()
			.where('guildId', '=', guildId)
			.where('id', '=', Number(amaId))
			.executeTakeFirst();

		if (!session) {
			return next(notFound('ama session not found'));
		}

		const questionCount = await getContext()
			.db.selectFrom('AMAQuestion')
			.select((eb) => eb.fn.count<string>('id').as('count'))
			.where('amaId', '=', session.id)
			.executeTakeFirstOrThrow();

		const promptData = await getContext()
			.db.selectFrom('AMAPromptData')
			.selectAll()
			.where('amaId', '=', session.id)
			.executeTakeFirstOrThrow();

		const channels = await fetchGuildChannels(guildId, discordAPIAma);
		if (!channels) {
			getContext().logger.warn({ guildId }, `Failed to fetch channels for guild ${guildId}`);
			return next(internal());
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
			await getContext().db.updateTable('AMASession').set({ ended: true }).where('id', '=', Number(amaId)).execute();
		}

		let promptMessageExists = false;
		if (promptData) {
			try {
				await discordAPIAma.channels.getMessage(session.promptChannelId, promptData.promptMessageId);
				promptMessageExists = true;
			} catch {
				promptMessageExists = false;
			}
		}

		const result: AMASessionDetailed = {
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

		res.statusCode = 200;
		res.setHeader('Content-Type', 'application/json');
		return res.end(JSON.stringify(result));
	}
}
