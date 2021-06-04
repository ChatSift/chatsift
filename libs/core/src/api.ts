import type { MaliciousFile, MaliciousDomain, MaliciousDomainCategory, MaliciousFileCategory, GlobalMaliciousDomain } from './models';

export interface ApiGetFiltersDomainsQuery {
  page: number;
}

export type ApiGetFiltersDomainsResult = GlobalMaliciousDomain[];

export type ApiPatchFiltersDomainsBody = {
  domain_id: number;
  category: MaliciousDomainCategory;
}[];

export type ApiPatchFiltersDomainsResult = GlobalMaliciousDomain[];

export interface ApiPostFiltersDomainsBody {
  domains: string[];
}

export interface ApiPostFiltersGuildDomainBody extends ApiPostFiltersDomainsBody {
  guild_only?: boolean;
}

export type ApiPostFiltersDomainsResult = Pick<MaliciousDomain, 'domain' | 'category'>[];

export interface ApiPutFiltersDomainsBody {
  domain: string;
  category: MaliciousDomainCategory;
}

export type ApiPutFiltersDomainsGuildBody = Exclude<ApiPutFiltersDomainsBody, 'category'>;

export type ApiPutFiltersDomainsResult = GlobalMaliciousDomain;

export interface ApiGetFilesDomainQuery {
  page: number;
}

export type ApiGetFilesDomainResult = MaliciousFile[];


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
