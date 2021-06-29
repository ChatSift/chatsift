import type {
  GatewayDispatchEvents,
  GatewayDispatchPayload,
  APIApplicationCommandInteraction,
  APIMessageComponentInteraction
} from 'discord-api-types/v8';
import type { Case } from './models';

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

export enum LogTypes {
  modAction
}

export interface LogBase<T extends LogTypes, D extends Record<string, any>> {
  type: T;
  data: D;
}

export type ModActionLog = LogBase<LogTypes.modAction, Case>;

export type Log = ModActionLog;
