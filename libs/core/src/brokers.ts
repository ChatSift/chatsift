import type {
  GatewayDispatchEvents,
  APIMessage,
  GatewayDispatchPayload,
  APIGuildInteraction
} from 'discord-api-types/v9';
import { BannedWord } from '.';
import type { ApiPostGuildsFiltersFilesResult, ApiPostGuildsFiltersUrlsResult, HttpCase } from './api';
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

export type FilesRunnerResult = OkRunnerResult<Runners.files, ApiPostGuildsFiltersFilesResult>;
export type UrlsRunnerResult = OkRunnerResult<Runners.urls, ApiPostGuildsFiltersUrlsResult>;
export type InvitesRunnerResult = OkRunnerResult<Runners.invites, string[]>;
export type WordsRunnerResult = OkRunnerResult<Runners.words, BannedWord | null>;

export type RunnerResult = NotOkRunnerResult | FilesRunnerResult | InvitesRunnerResult | UrlsRunnerResult | WordsRunnerResult;

export interface FilterTriggerData {
  message: APIMessage;
  triggers: Exclude<RunnerResult, NotOkRunnerResult>[];
}

export type FilterTriggerLog = LogBase<LogTypes.filterTrigger, FilterTriggerData>;

export type Log = ModActionLog | FilterTriggerLog;
