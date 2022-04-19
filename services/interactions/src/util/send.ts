/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */

import { Config, kConfig } from '@automoderator/injection';
import { File, Rest } from '@cordis/rest';
import {
	APIInteractionResponseCallbackData,
	APIModalInteractionResponseCallbackData,
	InteractionResponseType,
	RESTPostAPIChannelMessageJSONBody,
	Routes,
} from 'discord-api-types/v9';
import { container } from 'tsyringe';

export interface SendOptions {
	type?: InteractionResponseType;
	update?: boolean;
}

const REPLIED = new Set<string>();

// TODO(DD): Figure out better approach
/**
 * @param message Interaction to respond to
 * @param payload Payload response data
 * @param type The type of response to provide
 * @param followup If this is a followup to the original interaction response
 */
export const send = async (
	message: any,
	payload: (
		| RESTPostAPIChannelMessageJSONBody
		| APIInteractionResponseCallbackData
		| APIModalInteractionResponseCallbackData
	) & { files?: File[] },
	type?: InteractionResponseType,
	followup = false,
): Promise<unknown> => {
	const rest = container.resolve(Rest);
	const { discordClientId } = container.resolve<Config>(kConfig);

	if ('token' in message) {
		const { embeds, embed, files, ...r } = payload as RESTPostAPIChannelMessageJSONBody & { files?: File[] };
		const response = { ...r, embeds: embeds ?? (embed ? [embed] : undefined) };

		if (followup) {
			const { files, ...r } = payload;
			return rest.post(Routes.webhook(discordClientId, message.token), { data: r, files });
		}

		if (REPLIED.has(message.token)) {
			return rest.patch(Routes.webhookMessage(discordClientId, message.token, '@original'), { data: response, files });
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

	const { files, ...r } = payload;

	return rest.post<unknown, RESTPostAPIChannelMessageJSONBody>(Routes.channelMessages(message.channel_id), {
		// @ts-expect-error
		data: r,
		files,
	});
};
