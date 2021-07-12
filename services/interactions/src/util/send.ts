import { container } from 'tsyringe';
import { Rest } from '@cordis/rest';
import {
  APIInteractionApplicationCommandCallbackData,
  RESTPostAPIChannelMessageJSONBody,
  InteractionResponseType,
  Routes
} from 'discord-api-types/v8';
import { kConfig, Config } from '@automoderator/injection';

export interface SendOptions {
  type?: InteractionResponseType;
  update?: boolean;
}

/**
 * Responds to any given interaction *processed by @automoderator/interactions*
 * Which means that, by default `teractionResponseType.ChannelMessageWithSource` will actually be handled as an interaction response update
 * Anything else is treated as a regular interaction response - sent via /callback
 * Should also be noted, if there's no `token` in the passed `message` object the payload is instead sent as a regular message
 *
 * @param message Interaction to respond to
 * @param payload Payload response data
 * @param type The type of response to provide
 * @param type Additional options
 */
export const send = (
  message: any,
  payload: RESTPostAPIChannelMessageJSONBody | APIInteractionApplicationCommandCallbackData,
  options?: SendOptions
) => {
  const rest = container.resolve(Rest);
  const { discordClientId } = container.resolve<Config>(kConfig);

  if ('token' in message) {
    const { embed, ...r } = payload as RESTPostAPIChannelMessageJSONBody;
    const response = { ...r, embeds: embed ? [embed] : undefined };

    if (options?.update) {
      return rest.patch(Routes.webhookMessage(discordClientId, message.token, '@original'), { data: response });
    }

    if (message.res) {
      return message.res.end(
        JSON.stringify({
          type: options?.type ?? InteractionResponseType.ChannelMessageWithSource,
          data: response
        })
      );
    }
  }

  return rest.post<unknown, RESTPostAPIChannelMessageJSONBody>(Routes.channelMessages(message.channel_id), { data: payload });
};
