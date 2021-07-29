import type {
  MaliciousUrlCategory,
  Case,
  CaseAction,
  MaliciousFileCategory,
  MaliciousFile,
  MaliciousUrl
} from './models';
import type { Snowflake } from 'discord-api-types/v9';

export type ApiDeleteFiltersFilesBody = number[];

export type ApiDeleteFiltersFilesResult = MaliciousFile[];

export interface ApiGetFiltersFilesBody {
  page?: number;
}

export type ApiGetFiltersFilesResult = MaliciousFile[];

export type ApiPatchFiltersFilesBody = {
  file_id: number;
  category: MaliciousFileCategory;
}[];

export type ApiPatchFiltersFilesResult = MaliciousUrl[];

export interface ApiPostFiltersFilesBody {
  hashes: string[];
}

export type ApiPostFiltersFilesResult = MaliciousFile[];

export type ApiPutFiltersFilesBody = {
  hash: string;
  category: MaliciousFileCategory;
}[];

export type ApiPutFiltersFilesResult = MaliciousFile[];

export type ApiDeleteFiltersUrlsBody = number[];

export type ApiDeleteFiltersUrlsResult = MaliciousUrl[];

export interface ApiGetFiltersUrlsQuery {
  page?: number;
}

export type ApiGetFiltersUrlsResult = MaliciousUrl[];

export type ApiPatchFiltersUrlsBody = {
  url_id: number;
  category: MaliciousUrlCategory;
}[];

export type ApiPatchFiltersUrlsResult = MaliciousUrl[];

export interface ApiPostFiltersUrlsBody {
  urls: string[];
}

export type ApiPostFiltersUrlsResult = MaliciousUrl[];

export type ApiPutFiltersUrlsBody = {
  url: string;
  category: MaliciousUrlCategory;
}[];

export type ApiPutFiltersUrlsResult = MaliciousUrl[];

export type ApiGetGuildsCaseResult = Case;

export type ApiDeleteGuildsCaseResult = Case;

interface BaseCaseData {
  action: CaseAction;
  reason?: string;
  mod_id?: Snowflake;
  mod_tag?: string;
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
