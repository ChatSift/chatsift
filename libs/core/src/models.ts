import type { Snowflake } from 'discord-api-types/v9';

export interface GuildSettings {
  guild_id: Snowflake;
  mod_role: Snowflake | null;
  admin_role: Snowflake | null;
  mute_role: Snowflake | null;
  auto_pardon_mutes_after: number | null;
  use_url_filters: boolean;
  use_file_filters: boolean;
  use_invite_filters: boolean;
  mod_action_log_channel: Snowflake | null;
  filter_trigger_log_channel: Snowflake | null;
  user_update_log_channel: Snowflake | null;
  message_update_log_channel: Snowflake | null;
  min_join_age: number | null;
  no_blank_avatar: boolean;
  reports_channel: Snowflake | null;
}

export interface WebhookToken {
  channel_id: Snowflake;
  webhook_id: Snowflake;
  webhook_token: string;
}

export interface SelfAssignableRolePrompt {
  prompt_id: number;
  embed_title: string;
  embed_description: string | null;
  embed_color: number;
  embed_image: string | null;
  guild_id: Snowflake;
  channel_id: Snowflake;
  message_id: Snowflake;
  use_buttons: boolean;
}

export interface SelfAssignableRole {
  role_id: Snowflake;
  prompt_id: number;
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
  admin_id: Snowflake;
  created_at: Date;
  last_modified_at: Date;
  category: MaliciousUrlCategory;
}

export interface BannedWord {
  guild_id: Snowflake;
  word: string;
  flags: string;
  duration: number | null;
}

export interface FilterTrigger {
  guild_id: Snowflake;
  user_id: Snowflake;
  count: number;
}

export interface FilterIgnore {
  channel_id: Snowflake;
  guild_id: Snowflake;
  value: string;
}

export interface AllowedInvite {
  guild_id: Snowflake;
  invite_code: string;
}

export interface ReportedMessage {
  message_id: Snowflake;
  report_message_id: Snowflake;
  ack: boolean;
}

export interface MessageReporter {
  message_id: Snowflake;
  original: boolean;
  reporter_id: Snowflake;
  reporter_tag: string;
}

export interface LogIgnore {
  channel_id: Snowflake;
  guild_id: Snowflake;
}
