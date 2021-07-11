import { container } from 'tsyringe';
import { Rest } from '@cordis/rest';
import {
  APIInteractionApplicationCommandCallbackData,
  RESTPostAPIInteractionCallbackJSONBody,
  RESTPostAPIChannelMessageJSONBody,
  InteractionResponseType,
  Routes
} from 'discord-api-types/v8';
import { kConfig, Config } from '@automoderator/injection';

/**
 * Responds to any given interaction *processed by @automoderator/interactions*
 * Which means that, by default `teractionResponseType.ChannelMessageWithSource` will actually be handled as an interaction response update
 * Anything else is treated as a regular interaction response - sent via /callback
 * Should also be noted, if there's no `token` in the passed `message` object the payload is instead sent as a regular message
 *
 * @param message Interaction to respond to
 * @param payload Payload response data
 * @param type The type of response to provide
 */
export const send = (
  message: any,
  payload: RESTPostAPIChannelMessageJSONBody | APIInteractionApplicationCommandCallbackData,
  type: InteractionResponseType = InteractionResponseType.ChannelMessageWithSource
) => {
  const rest = container.resolve(Rest);
  const { discordClientId } = container.resolve<Config>(kConfig);

  if ('token' in message) {
    const { embed, ...r } = payload as RESTPostAPIChannelMessageJSONBody;
    const response = { ...r, embeds: embed ? [embed] : undefined };

    if (type !== InteractionResponseType.ChannelMessageWithSource) {
      return rest.post<unknown, RESTPostAPIInteractionCallbackJSONBody>(
        Routes.interactionCallback(message.id, message.token),
        {
          data: {
            type,
            ...response
          } as unknown as RESTPostAPIInteractionCallbackJSONBody
        }
      );
    }

    return rest.patch(Routes.webhookMessage(discordClientId, message.token, '@original'), { data: response });
  }

  return rest.post<unknown, RESTPostAPIChannelMessageJSONBody>(Routes.channelMessages(message.channel_id), { data: payload });
};
