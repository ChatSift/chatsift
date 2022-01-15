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

const DM_CHANNEL_CACHE = new Map<Snowflake, Snowflake>();
setInterval(() => DM_CHANNEL_CACHE.clear(), 9e4).unref();

export const dmUser = async (userId: Snowflake, content: string, guildId?: Snowflake) => {
	const rest = container.resolve(Rest);

	if (guildId) {
		const member = await rest.get(Routes.guildMember(guildId, userId)).catch(() => null);
		if (!member) {
			return null;
		}
	}

	const dmChannel = DM_CHANNEL_CACHE.has(userId)
		? DM_CHANNEL_CACHE.get(userId)!
		: await rest
				.post<RESTPostAPICurrentUserCreateDMChannelResult, RESTPostAPICurrentUserCreateDMChannelJSONBody>(
					Routes.userChannels(),
					{
						data: {
							recipient_id: userId,
						},
					},
				)
				.then((c) => {
					DM_CHANNEL_CACHE.set(userId, c.id);
					return c.id;
				})
				.catch(() => null);

	if (dmChannel) {
		await rest
			.post<unknown, RESTPostAPIChannelMessageJSONBody>(Routes.channelMessages(dmChannel), {
				data: {
					content,
				},
			})
			.catch(() => null);
	}
};
