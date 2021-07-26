import type {
  GatewayDispatchEvents,
  GatewayDispatchPayload,
  APIGuildInteraction
} from 'discord-api-types/v9';
import { HttpCase } from './api';
import type { CaseAction, WarnPunishmentAction } from './models';

type SanitizedDiscordEvents = {
  [K in GatewayDispatchEvents]: GatewayDispatchPayload & {
    t: K;
  };
};

export type DiscordEvents = {
  [K in keyof SanitizedDiscordEvents]: SanitizedDiscordEvents[K]['d'];
};

export interface DiscordInteractions {
  command: APIGuildInteraction;
  component: APIGuildInteraction;
}

export enum LogTypes {
  modAction,
  filterTrigger
}

export interface LogBase<T extends LogTypes, D extends Record<string, any>> {
  type: T;
  data: D;
}

interface WarnCaseExtrasNoDuration {
  triggered: WarnPunishmentAction.kick;
}

interface WarnCaseExtrasWithDuration {
  triggered: WarnPunishmentAction.mute | WarnPunishmentAction.ban;
  duration?: number;
  extendedBy?: number;
}

export type WarnCaseExtras = WarnCaseExtrasNoDuration | WarnCaseExtrasWithDuration;

export type NonWarnCase = Omit<HttpCase, 'action_type'> & { action_type: Exclude<CaseAction, CaseAction.warn> };
export type WarnCase = Omit<HttpCase, 'action_type'> & {
  action_type: CaseAction.warn;
  extra?: WarnCaseExtras;
};

export type ModActionLog = LogBase<LogTypes.modAction, NonWarnCase | WarnCase>;

export interface FilterTriggerData {

}

export type FilterTriggerLog = LogBase<LogTypes.filterTrigger, FilterTriggerData>;

export type Log = ModActionLog | FilterTriggerLog;
