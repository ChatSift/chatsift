/* istanbul ignore file */
import { kLogger } from '@automoderator/injection';
import { Rest } from '@cordis/rest';
import {
	RESTPostAPIChannelMessageJSONBody,
	RESTPostAPICurrentUserCreateDMChannelJSONBody,
	RESTPostAPICurrentUserCreateDMChannelResult,
	Routes,
	Snowflake,
} from 'discord-api-types/v9';
import type { Logger } from 'pino';
import { container } from 'tsyringe';

export const dmUser = async (userId: Snowflake, content: string, guildId?: Snowflake) => {
	const rest = container.resolve(Rest);
	const logger = container.resolve<Logger>(kLogger);

	if (guildId) {
		const member = await rest.get(Routes.guildMember(guildId, userId)).catch(() => null);
		if (!member) {
			return null;
		}
	}

	const dmChannel = await rest
		.post<RESTPostAPICurrentUserCreateDMChannelResult, RESTPostAPICurrentUserCreateDMChannelJSONBody>(
			Routes.userChannels(),
			{
				data: {
					recipient_id: userId,
				},
			},
		)
		.catch(() => {
			logger.warn(`Failed to create DM channel with user ${userId}`);
			return null;
		});

	if (dmChannel) {
		await rest
			.post<unknown, RESTPostAPIChannelMessageJSONBody>(Routes.channelMessages(dmChannel.id), {
				data: {
					content,
				},
			})
			.catch(() => null);
	}
};
