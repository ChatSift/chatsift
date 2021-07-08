import type {
  GatewayDispatchEvents,
  GatewayDispatchPayload,
  APIApplicationCommandInteraction,
  APIMessageComponentInteraction
} from 'discord-api-types/v8';

type SanitizedDiscordEvents = {
  [K in GatewayDispatchEvents]: GatewayDispatchPayload & {
    t: K;
  };
};

export type DiscordEvents = {
  [K in keyof SanitizedDiscordEvents]: SanitizedDiscordEvents[K]['d'];
};

export interface DiscordInteractions {
  command: APIApplicationCommandInteraction;
  component: APIMessageComponentInteraction;
}
