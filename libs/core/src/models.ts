import type { Snowflake } from 'discord-api-types/v9';

export enum UseFilterMode {
  none,
  guildOnly,
  all
}

export interface GuildSettings {
  guild_id: Snowflake;
  mod_role: Snowflake | null;
  admin_role: Snowflake | null;
  mute_role: Snowflake | null;
  auto_pardon_mutes_after: number | null;
  use_url_filters: UseFilterMode;
  use_file_filters: UseFilterMode;
  mod_action_log_channel: Snowflake | null;
  assignable_roles_prompt: string | null;
}

export interface SelfAssignableRole {
  role_id: Snowflake;
  guild_id: Snowflake;
}

export enum WarnPunishmentAction {
  mute,
  kick,
  ban
}

interface BaseWarnPunishment {
  guild_id: Snowflake;
  warns: number;
}

interface WarnPunishmentWithNoDuration extends BaseWarnPunishment {
  action_type: WarnPunishmentAction.kick;
  duration: null;
}

interface WarnPunishmentWithDuration extends BaseWarnPunishment {
  action_type: Exclude<WarnPunishmentAction, WarnPunishmentAction.kick>;
  duration: number | null;
}

export type WarnPunishment = WarnPunishmentWithNoDuration | WarnPunishmentWithDuration;

export enum CaseAction {
  warn,
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
  pardoned_by: Snowflake | null;
  created_at: Date;
}

export interface UnmuteRole {
  case_id: number;
  role_id: Snowflake;
}

export interface User {
  user_id: Snowflake;
  perms: string;
}

export interface App {
  app_id: number;
  name: string;
  perms: string;
}

export interface AppGuild {
  app_id: number;
  guild_id: Snowflake;
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
  guild_id: Snowflake | null;
  admin_id: Snowflake | null;
  created_at: Date;
  last_modified_at: Date;
  category: MaliciousFileCategory | null;
}

export interface LocalMaliciousFile extends MaliciousFile {
  guild_id: Snowflake;
  admin_id: null;
  category: null;
}

export interface GlobalMaliciousFile extends MaliciousFile {
  guild_id: null;
  admin_id: Snowflake;
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
  guild_id: Snowflake | null;
  admin_id: Snowflake | null;
  created_at: Date;
  last_modified_at: Date;
  category: MaliciousUrlCategory | null;
}

export interface LocalMaliciousUrl extends MaliciousUrl {
  guild_id: Snowflake;
  admin_id: null;
  category: null;
}

export interface GlobalMaliciousUrl extends MaliciousUrl {
  guild_id: null;
  admin_id: Snowflake;
  category: MaliciousUrlCategory;
}

export interface FilterTrigger {
  guild_id: Snowflake;
  user_id: Snowflake;
  count: number;
}
