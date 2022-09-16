import { kLogger } from '@automoderator/injection';
import { REST } from '@discordjs/rest';
import type {
	RESTPostAPIChannelMessageJSONBody,
	RESTPostAPICurrentUserCreateDMChannelJSONBody,
	RESTPostAPICurrentUserCreateDMChannelResult,
	Snowflake,
} from 'discord-api-types/v9';
import { Routes } from 'discord-api-types/v9';
import type { Logger } from 'pino';
import { container } from 'tsyringe';

export const dmUser = async (userId: Snowflake, content: string, guildId?: Snowflake) => {
	const rest = container.resolve(REST);
	const logger = container.resolve<Logger>(kLogger);

	if (guildId) {
		const member = await rest.get(Routes.guildMember(guildId, userId)).catch(() => null);
		if (!member) {
			return;
		}
	}

	const body: RESTPostAPICurrentUserCreateDMChannelJSONBody = { recipient_id: userId };
	const dmChannel = (await rest.post(Routes.userChannels(), { body }).catch(() => {
		logger.warn(`Failed to create DM channel with user ${userId}`);
		return null;
	})) as RESTPostAPICurrentUserCreateDMChannelResult | null;

	if (dmChannel) {
		const body: RESTPostAPIChannelMessageJSONBody = { content };
		await rest.post(Routes.channelMessages(dmChannel.id), { body }).catch(() => null);
	}
};
