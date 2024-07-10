import { API, type RESTPostAPIChannelMessageJSONBody, type Snowflake } from '@discordjs/core';
import type { Logger } from 'pino';
import { globalContainer, INJECTION_TOKENS } from '../container.js';

export interface DMUserOptions {
	bindToGuildId?: Snowflake;
	data: RESTPostAPIChannelMessageJSONBody;
	userId: Snowflake;
}

export async function dmUser({ userId, bindToGuildId, data }: DMUserOptions): Promise<boolean> {
	const api = globalContainer.get(API);
	const logger = globalContainer.get<Logger>(INJECTION_TOKENS.logger);

	if (bindToGuildId) {
		const member = await api.guilds.getMember(bindToGuildId, userId).catch((error) => {
			logger.warn({ error }, 'Failed to fetch member - assuming they are not in the guild.');
			return null;
		});

		if (!member) {
			return false;
		}
	}

	try {
		const channel = await api.users.createDM(userId);
		try {
			await api.channels.createMessage(channel.id, data);
			return true;
		} catch (sendError) {
			logger.warn({ error: sendError }, 'Failed to send message to DM channel');
		}
	} catch (createDMError) {
		logger.warn({ error: createDMError }, 'Failed to create DM channel');
	}

	return false;
}
