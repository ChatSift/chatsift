import type { Snowflake } from 'discord-api-types/v8';

export interface User {
  user_id: Snowflake;
  perms: bigint;
}

export interface App {
  app_id: number;
  name: string;
  perms: bigint;
}

export interface Sig {
  app_id: number;
  sig: string;
  last_used_at: Date;
}

export enum MaliciousFileCategory {
  nsfw,
  gore,
  shock,
  crasher
}

export interface MaliciousFile {
  file_id: number;
  file_hash: string;
  admin_id: Snowflake;
  created_at: Date;
  last_modified_at: Date;
  category: MaliciousFileCategory;
}

export enum MaliciousDomainCategory {
  malicious,
  phishing,
  scam,
  spam,
  shock,
  deceptive,
  urlShortner
}

export interface MaliciousDomain {
  domain_id: number;
  domain: string;
  guild_id?: Snowflake;
  admin_id?: Snowflake;
  created_at: Date;
  last_modified_at: Date;
  category?: MaliciousDomainCategory;
}

export interface LocalMaliciousDomain extends MaliciousDomain {
  guild_id: Snowflake;
  admin_id: never;
  category: never;
}

export interface GlobalMaliciousDomain extends MaliciousDomain {
  guild_id: never;
  admin_id: Snowflake;
  category: MaliciousDomainCategory;
}
