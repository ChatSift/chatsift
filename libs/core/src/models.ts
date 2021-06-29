import type { Snowflake } from 'discord-api-types/v8';

export enum UseFilterMode {
  none,
  guildOnly,
  all
}

export interface GuildSettings {
  guild_id: Snowflake;
  mod_role: Snowflake | null;
  use_url_filters: UseFilterMode;
  use_file_filters: UseFilterMode;
  mod_action_log_channel: Snowflake | null;
}

export enum CaseAction {
  warn,
  strike,
  mute,
  unmute,
  kick,
  softban,
  ban,
  unban
}

export interface Case {
  id: number;
  guild_id: Snowflake;
  log_message_id: Snowflake | null;
  case_id: number;
  ref_id: number | null;
  target_id: Snowflake;
  target_tag: string;
  mod_id: Snowflake | null;
  mod_tag: string | null;
  action_type: CaseAction;
  reason: string | null;
  expires_at: Date | null;
  processed: boolean;
  created_at: Date;
}

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

export enum MaliciousUrlCategory {
  malicious,
  phishing,
  scam,
  spam,
  shock,
  deceptive,
  urlShortner
}

export interface MaliciousUrl {
  url_id: number;
  url: string;
  guild_id?: Snowflake;
  admin_id?: Snowflake;
  created_at: Date;
  last_modified_at: Date;
  category?: MaliciousUrlCategory;
}

export interface LocalMaliciousUrl extends MaliciousUrl {
  guild_id: Snowflake;
  admin_id: never;
  category: never;
}

export interface GlobalMaliciousUrl extends MaliciousUrl {
  guild_id: never;
  admin_id: Snowflake;
  category: MaliciousUrlCategory;
}
