import { setTimeout } from 'node:timers';
import type { Config } from '@automoderator/injection';
import { kConfig } from '@automoderator/injection';
import type { RawFile } from '@discordjs/rest';
import { REST } from '@discordjs/rest';
import type {
	APIInteractionResponseCallbackData,
	APIModalInteractionResponseCallbackData,
	RESTPostAPIChannelMessageJSONBody,
} from 'discord-api-types/v9';
import { InteractionResponseType, Routes } from 'discord-api-types/v9';
import { container } from 'tsyringe';

export type SendOptions = {
	type?: InteractionResponseType;
	update?: boolean;
};

const REPLIED = new Set<string>();

// TODO(DD): Figure out better approach
/**
 * @param message - Interaction to respond to
 * @param payload - Payload response data
 * @param type - The type of response to provide
 * @param followup - If this is a followup to the original interaction response
 */
export const send = async (
	message: any,
	payload: { files?: RawFile[] } & (APIInteractionResponseCallbackData | APIModalInteractionResponseCallbackData),
	type?: InteractionResponseType,
	followup = false,
): Promise<unknown> => {
	const rest = container.resolve(REST);
	const { discordClientId } = container.resolve<Config>(kConfig);

	if ('token' in message) {
		// eslint-disable-next-line deprecation/deprecation
		const { embeds, embed, files, ...other } = payload as RESTPostAPIChannelMessageJSONBody & { files?: RawFile[] };
		const response = { ...other, embeds: embeds ?? (embed ? [embed] : undefined) };

		if (followup) {
			const { files, ...other } = payload;
			return rest.post(Routes.webhook(discordClientId, message.token), { body: other, files });
		}

		if (REPLIED.has(message.token)) {
			return rest.patch(Routes.webhookMessage(discordClientId, message.token, '@original'), { body: response, files });
		}

		if (message.res) {
			message.res.end(
				JSON.stringify({
					type: type ?? InteractionResponseType.ChannelMessageWithSource,
					data: response,
				}),
			);

			REPLIED.add(message.token);
			setTimeout(() => REPLIED.delete(message.token), 6e4).unref();

			if (files) {
				await send(message, { files });
			}

			return;
		}
	}

	const { files, ...other } = payload as RESTPostAPIChannelMessageJSONBody & { files?: RawFile[] };

	return rest.post(Routes.channelMessages(message.channel_id), {
		body: other,
		files,
	});
};
