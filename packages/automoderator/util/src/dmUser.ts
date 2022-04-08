/* istanbul ignore file */
import { Rest } from '@cordis/rest';
import {
	RESTPostAPIChannelMessageJSONBody,
	RESTPostAPICurrentUserCreateDMChannelJSONBody,
	RESTPostAPICurrentUserCreateDMChannelResult,
	Routes,
	Snowflake,
} from 'discord-api-types/v9';
import { container } from 'tsyringe';

export const dmUser = async (userId: Snowflake, content: string, guildId?: Snowflake) => {
	const rest = container.resolve(Rest);

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
		.catch(() => null);

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
