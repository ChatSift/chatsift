import type { MaliciousFile, MaliciousDomain } from './models';

export interface ApiPostDomainsFilterBody {
  domain: string[];
}

export type ApiPostDomainsFilterResult = Pick<MaliciousDomain, 'domain' | 'category'>[];

export interface ApiPostFilesFilterBody {
  hashes: string[];
}

export type ApiPostFilesFilterResult = Pick<MaliciousFile, 'file_hash' | 'category'>[];
