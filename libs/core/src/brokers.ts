import type {
  APIGuildInteraction, APIMessage, GatewayDispatchEvents, GatewayDispatchPayload
} from 'discord-api-types/v9';
import type { ApiPostFiltersFilesResult, ApiPostFiltersUrlsResult, HttpCase } from './api';
import type { BannedWord, CaseAction, WarnPunishmentAction } from './models';

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

type OrArray<T> = T | T[];
export type ModActionLog = LogBase<LogTypes.modAction, OrArray<NonWarnCase | WarnCase>>;

export enum Runners {
  files,
  urls,
  invites,
  words
}

export interface BaseRunnerResult {
  runner: Runners;
}

export interface NotOkRunnerResult extends BaseRunnerResult {
  ok: false;
}

export interface OkRunnerResult<R extends Runners, T> extends BaseRunnerResult {
  ok: true;
  runner: R;
  data: T;
  actioned: boolean;
}

export type WordsRunnerResultData = BannedWord & { isUrl: boolean };

export type FilesRunnerResult = OkRunnerResult<Runners.files, ApiPostFiltersFilesResult>;
export type UrlsRunnerResult = OkRunnerResult<Runners.urls, ApiPostFiltersUrlsResult>;
export type InvitesRunnerResult = OkRunnerResult<Runners.invites, string[]>;
export type WordsRunnerResult = OkRunnerResult<Runners.words, WordsRunnerResultData[]>;

export type RunnerResult = NotOkRunnerResult | FilesRunnerResult | InvitesRunnerResult | UrlsRunnerResult | WordsRunnerResult;

export interface FilterTriggerData {
  message: APIMessage;
  triggers: Exclude<RunnerResult, NotOkRunnerResult>[];
}

export type FilterTriggerLog = LogBase<LogTypes.filterTrigger, FilterTriggerData>;

export type Log = ModActionLog | FilterTriggerLog;
