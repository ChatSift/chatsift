import type {
  GatewayDispatchEvents,
  GatewayDispatchPayload,
  APIApplicationCommandInteraction,
  APIMessageComponentInteraction,
  Snowflake
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

export enum LogTypes {
  modAction
}

export interface LogBase<T extends LogTypes, D extends Record<string, any>> {
  type: T;
  data: D;
}

export enum ModAction {
  warn,
  strike,
  mute,
  unmute,
  kick,
  softban,
  ban,
  unban
}

export type ModActionLog = LogBase<LogTypes.modAction, {
  mod_id: Snowflake;
  target_id: Snowflake;
  type: ModAction;
  createdAt: Date;
  expiresAt?: Date;
  reason?: string;
}>;

export type Log = ModActionLog;
