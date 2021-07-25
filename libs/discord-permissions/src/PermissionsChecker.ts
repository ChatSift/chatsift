import { singleton, inject } from 'tsyringe';
import { kLogger, kSql } from '@automoderator/injection';
import { DiscordPermissions } from './DiscordPermissions';
import { Rest } from '@cordis/rest';
import { APIInteractionGuildMember, RESTGetAPIGuildResult, Routes, Snowflake } from 'discord-api-types/v9';
import type { Sql } from 'postgres';
import type { GuildSettings } from '@automoderator/core';
import type { Logger } from 'pino';

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
    public readonly rest: Rest
  ) {}

  public async checkMod(interaction: PermissionsCheckerData, settings?: GuildSettings): Promise<boolean> {
    if (!settings) {
      [settings] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${interaction.guild_id}`;
    }

    if (!settings?.mod_role) {
      return false;
    }

    return interaction.member.roles.includes(settings.mod_role);
  }

  public async checkAdmin(interaction: PermissionsCheckerData, settings?: GuildSettings): Promise<boolean> {
    if (new DiscordPermissions(BigInt(interaction.member.permissions)).has('manageGuild', true)) {
      return true;
    }

    if (!settings) {
      [settings] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${interaction.guild_id}`;
    }

    if (!settings?.admin_role) {
      return false;
    }

    return interaction.member.roles.includes(settings.admin_role);
  }

  public async checkOwner(interaction: PermissionsCheckerData): Promise<boolean> {
    const guild = await this.rest.get<RESTGetAPIGuildResult>(Routes.guild(interaction.guild_id)).catch(error => {
      this.logger.warn({ error }, 'Failed a checkOwner guild fetch - returning false');
      return null;
    });

    if (!guild) {
      return false;
    }

    return interaction.member.user.id === guild.owner_id;
  }

  public async check(interaction: PermissionsCheckerData, perm: UserPerms): Promise<boolean> {
    const [settings] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${interaction.guild_id}`;

    switch (perm) {
      case UserPerms.none: {
        return true;
      }

      // Checks are in order of speed (simple bitfield math OR query -> db query + array includes -> HTTP call and string comparison)
      case UserPerms.mod: {
        return await this.checkAdmin(interaction, settings) || await this.checkMod(interaction, settings) || this.checkOwner(interaction);
      }

      case UserPerms.admin: {
        return await this.checkAdmin(interaction, settings) || this.checkOwner(interaction);
      }

      case UserPerms.owner: {
        return this.checkOwner(interaction);
      }
    }
  }
}
