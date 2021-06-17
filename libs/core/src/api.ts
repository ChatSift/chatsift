import type { MaliciousFile, MaliciousUrl, MaliciousUrlCategory, MaliciousFileCategory, GlobalMaliciousUrl } from './models';

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
