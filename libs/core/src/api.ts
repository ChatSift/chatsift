import type {
  MaliciousFile,
  MaliciousUrl,
  MaliciousUrlCategory,
  MaliciousFileCategory,
  GlobalMaliciousUrl,
  Case,
  CaseAction
} from './models';
import type { Snowflake } from 'discord-api-types/v8';

export interface ApiGetFiltersUrlsQuery {
  page: number;
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

export interface ApiPostFiltersGuildUrlBody extends ApiPostFiltersUrlsBody {
  guild_only?: boolean;
}

export type ApiPostFiltersUrlsResult = Pick<MaliciousUrl, 'url' | 'category'>[];

export interface ApiPutFiltersUrlsBody {
  url: string;
  category: MaliciousUrlCategory;
}

export type ApiPutFiltersUrlsGuildBody = Exclude<ApiPutFiltersUrlsBody, 'category'>;

export type ApiPutFiltersUrlsResult = GlobalMaliciousUrl;

export interface ApiGetFiltersFilesQuery {
  page: number;
}

export type ApiGetFFiltersFilesResult = MaliciousFile[];


export type ApiPatchFiltersFilesBody = {
  file_id: number;
  category: MaliciousFileCategory;
}[];

export type ApiPatchFiltersFilesResult = MaliciousFile[];

export interface ApiPostFiltersFilesBody {
  hashes: string[];
}

export type ApiPostFiltersFilesResult = Pick<MaliciousFile, 'file_hash' | 'category'>[];

export interface ApiPutFiltersFilesBody {
  hash: string;
  category: MaliciousFileCategory;
}

export type ApiPutFiltersFilesResult = MaliciousFile;

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

export type ApiPostGuildsCasesResult = Case[];

interface UpdateCaseBaseData {
  case_id: number;
  expires_at?: Date | null;
  reason?: string;
  ref_id?: number;
  processed?: boolean;
}

export type CaseUpdateData = (
  | UpdateCaseBaseData
  | (UpdateCaseBaseData & { mod_id: string; mod_tag: string })
);

export type ApiPatchGuildsCasesBody = CaseUpdateData[];
