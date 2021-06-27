import { container } from 'tsyringe';
import { Rest } from '@cordis/rest';
import {
  APIInteractionApplicationCommandCallbackData,
  RESTPostAPIInteractionCallbackJSONBody,
  RESTPostAPIChannelMessageJSONBody,
  InteractionResponseType,
  Routes
} from 'discord-api-types/v8';

export const send = async (
  message: any,
  payload: RESTPostAPIChannelMessageJSONBody | APIInteractionApplicationCommandCallbackData,
  type: InteractionResponseType = InteractionResponseType.ChannelMessageWithSource
) => {
  const rest = container.resolve(Rest);

  if ('token' in message) {
    const { embed, ...r } = payload as RESTPostAPIChannelMessageJSONBody;
    const response = { ...r, embeds: embed ? [embed] : undefined };

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

  return rest.post<unknown, RESTPostAPIChannelMessageJSONBody>(Routes.channelMessages(message.channel_id), { data: payload });
};
