import type {
  GatewayDispatchEvents,
  GatewayDispatchPayload,
  APIApplicationCommandInteraction,
  APIMessageComponentInteraction
} from 'discord-api-types/v8';
import { HttpCase } from './api';
import type { CaseAction, StrikePunishmentAction } from './models';

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

interface StrikeCaseExtrasNoDuration {
  triggered: StrikePunishmentAction.kick;
}

interface StrikeCaseExtrasWithDuration {
  triggered: StrikePunishmentAction.mute | StrikePunishmentAction.ban;
  duration?: number;
  extendedBy?: number;
}

export type StrikeCaseExtras = StrikeCaseExtrasNoDuration | StrikeCaseExtrasWithDuration;

export type NonStrikeCase = Omit<HttpCase, 'action_type'> & { action_type: Exclude<CaseAction, CaseAction.strike> };
export type StrikeCase = Omit<HttpCase, 'action_type'> & {
  action_type: CaseAction.strike;
  extra?: StrikeCaseExtras;
};

export type ModActionLog = LogBase<LogTypes.modAction, NonStrikeCase | StrikeCase>;

export type Log = ModActionLog;
