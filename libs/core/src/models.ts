import type { Snowflake } from 'discord-api-types/v8';

export interface App {
  app_id: number;
  name: string;
  perms: number;
}

export interface Sig {
  app_id: number;
  sig: string;
  last_used_at: Date;
}

export interface MaliciousFile {
  file_id: number;
  file_hash: string;
  admin_id: Snowflake;
  reason: string;
  created_at: Date;
  last_modified_at: Date;
}
