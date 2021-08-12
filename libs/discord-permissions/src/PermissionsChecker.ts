import type { GuildSettings } from '@automoderator/core';
import { Config, kConfig, kLogger, kSql } from '@automoderator/injection';
import { Rest } from '@cordis/rest';
import { APIInteractionGuildMember, RESTGetAPIGuildResult, Routes, Snowflake } from 'discord-api-types/v9';
import type { Logger } from 'pino';
import type { Sql } from 'postgres';
import { inject, singleton } from 'tsyringe';
import { DiscordPermissions } from './DiscordPermissions';

export enum UserPerms {
  none,
  mod,
  admin,
  owner
}

export interface PermissionsCheckerData {
  member: APIInteractionGuildMember;
  guild_id: Snowflake;
}

@singleton()
export class PermissionsChecker {
  public constructor(
    @inject(kSql) public readonly sql: Sql<{}>,
    @inject(kLogger) public readonly logger: Logger,
    @inject(kConfig) public readonly config: Config,
    public readonly rest: Rest
  ) {}

  public async checkMod(data: PermissionsCheckerData, settings?: GuildSettings): Promise<boolean> {
    if (!settings) {
      [settings] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${data.guild_id}`;
    }

    if (!settings?.mod_role) {
      return false;
    }

    return data.member.roles.includes(settings.mod_role);
  }

  public async checkAdmin(data: PermissionsCheckerData, settings?: GuildSettings): Promise<boolean> {
    if (new DiscordPermissions(BigInt(data.member.permissions)).has('manageGuild', true)) {
      return true;
    }

    if (!settings) {
      [settings] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${data.guild_id}`;
    }

    if (!settings?.admin_role) {
      return false;
    }

    return data.member.roles.includes(settings.admin_role);
  }

  public async checkOwner(data: PermissionsCheckerData): Promise<boolean> {
    const guild = await this.rest.get<RESTGetAPIGuildResult>(Routes.guild(data.guild_id)).catch(error => {
      this.logger.warn({ error }, 'Failed a checkOwner guild fetch - returning false');
      return null;
    });

    if (!guild) {
      return false;
    }

    return data.member.user.id === guild.owner_id;
  }

  public async check(data: PermissionsCheckerData, perm: UserPerms, settings?: GuildSettings): Promise<boolean> {
    if (this.config.devIds.includes(data.member.user.id)) {
      return true;
    }

    if (!settings) {
      [settings] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${data.guild_id}`;
    }

    switch (perm) {
      case UserPerms.none: {
        return true;
      }

      // Checks are in order of speed (simple bitfield math OR query -> db query + array includes -> HTTP call and string comparison)
      case UserPerms.mod: {
        return await this.checkAdmin(data, settings) || await this.checkMod(data, settings) || this.checkOwner(data);
      }

      case UserPerms.admin: {
        return await this.checkAdmin(data, settings) || this.checkOwner(data);
      }

      case UserPerms.owner: {
        return this.checkOwner(data);
      }
    }
  }
}
