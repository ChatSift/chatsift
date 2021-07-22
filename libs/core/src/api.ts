import type {
  MaliciousUrlCategory,
  GlobalMaliciousUrl,
  Case,
  CaseAction,
  LocalMaliciousUrl,
  MaliciousUrl,
  GlobalMaliciousFile,
  MaliciousFileCategory,
  LocalMaliciousFile,
  MaliciousFile
} from './models';
import type { Snowflake } from 'discord-api-types/v8';

export type ApiDeleteFiltersFilesBody = number[];

export type ApiDeleteFiltersFilesResult = GlobalMaliciousFile[];

export interface ApiGetFiltersFilesBody {
  page?: number;
}

export type ApiGetFiltersFilesResult = GlobalMaliciousFile[];

export type ApiPatchFiltersFilesBody = {
  file_id: number;
  category: MaliciousFileCategory;
}[];

export type ApiPatchFiltersFilesResult = GlobalMaliciousUrl[];

export interface ApiPostFiltersFilesBody {
  hashes: string[];
}

export type ApiPostFiltersFilesResult = GlobalMaliciousUrl[];

export type ApiPutFiltersFilesBody = {
  hash: string;
  category: MaliciousFileCategory;
}[];

export type ApiPutFiltersFilesResult = GlobalMaliciousFile[];

export type ApiDeleteFiltersUrlsBody = number[];

export type ApiDeleteFiltersUrlsResult = GlobalMaliciousUrl[];

export interface ApiGetFiltersUrlsQuery {
  page?: number;
}

export type ApiGetFiltersUrlsResult = GlobalMaliciousUrl[];

export type ApiPatchFiltersUrlsBody = {
  url_id: number;
  category: MaliciousUrlCategory;
}[];

export type ApiPatchFiltersUrlsResult = GlobalMaliciousUrl[];

export interface ApiPostFiltersUrlsBody {
  urls: string[];
}

export type ApiPostFiltersUrlsResult = GlobalMaliciousUrl[];

export type ApiPutFiltersUrlsBody = {
  url: string;
  category: MaliciousUrlCategory;
}[];

export type ApiPutFiltersUrlsResult = GlobalMaliciousUrl[];

export type ApiGetGuildsCaseResult = Case;

export type ApiDeleteGuildsCaseResult = Case;

interface BaseCaseData {
  action: CaseAction;
  reason?: string;
  mod_id: Snowflake;
  mod_tag: string;
  target_id: Snowflake;
  target_tag: string;
  reference_id?: number;
  created_at?: Date;
}

interface CaseDataOther extends BaseCaseData {
  action: Exclude<CaseAction, CaseAction.mute | CaseAction.ban>;
}

interface CaseDataWithExpiry extends BaseCaseData {
  action: CaseAction.mute | CaseAction.ban;
  expires_at?: Date | null;
}

export type CaseData = CaseDataOther | CaseDataWithExpiry;

export type ApiPostGuildsCasesBody = CaseData[];

export type HttpCase = Omit<Case, 'expires_at'> & { expires_at: string };

export type ApiPostGuildsCasesResult = HttpCase[];

interface UpdateCaseBaseData {
  case_id: number;
  expires_at?: Date | null;
  reason?: string;
  ref_id?: number;
  processed?: boolean;
  pardoned_by?: Snowflake;
}

export type CaseUpdateData = (
  | UpdateCaseBaseData
  | (UpdateCaseBaseData & { mod_id: Snowflake; mod_tag: string })
);

export type ApiPatchGuildsCasesBody = CaseUpdateData[];

export type ApiDeleteGuildsFiltersFilesBody = string[];

export type ApiDeleteGuildsFiltersFilesResult = LocalMaliciousFile[];

export interface ApiGetGuildsFiltersFilesQuery {
  page?: number;
}

export type ApiGetGuildsFiltersFilesResult = LocalMaliciousFile[];

export interface ApiPostGuildsFiltersFilesBody {
  hashes: string[];
  guild_only?: boolean;
}

export type ApiPostGuildsFiltersFilesResult = MaliciousFile[];

export type ApiPutGuildsFiltersFilesBody = string[];

export type ApiPutGuildsFiltersFilesResult = LocalMaliciousFile[];

export type ApiDeleteGuildsFiltersUrlsBody = string[];

export type ApiDeleteGuildsFiltersUrlsResult = LocalMaliciousUrl[];

export interface ApiGetGuildsFiltersUrlsQuery {
  page?: number;
}

export type ApiGetGuildsFiltersUrlsResult = LocalMaliciousUrl[];

export interface ApiPostGuildsFiltersUrlsBody {
  urls: string[];
  guild_only?: boolean;
}

export type ApiPostGuildsFiltersUrlsResult = MaliciousUrl[];

export type ApiPutGuildsFiltersUrlsBody = string[];

export type ApiPutGuildsFiltersUrlsResult = LocalMaliciousUrl[];
