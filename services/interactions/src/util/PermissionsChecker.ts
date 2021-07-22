import { singleton, inject } from 'tsyringe';
import { kLogger, kSql } from '@automoderator/injection';
import { DiscordPermissions } from '@automoderator/discord-permissions';
import { Rest } from '@cordis/rest';
import { APIGuildInteraction, RESTGetAPIGuildResult, Routes } from 'discord-api-types/v9';
import type { Sql } from 'postgres';
import type { GuildSettings } from '@automoderator/core';
import type { Logger } from 'pino';

export enum UserPerms {
  none,
  mod,
  admin,
  owner
}

@singleton()
export class PermissionsChecker {
  public constructor(
    @inject(kSql) public readonly sql: Sql<{}>,
    @inject(kLogger) public readonly logger: Logger,
    public readonly rest: Rest
  ) {}

  public async checkMod(interaction: APIGuildInteraction): Promise<boolean> {
    const [{ mod_role } = { mod_role: null }] = await this
      .sql<[Pick<GuildSettings, 'mod_role'>?]>`SELECT mod_role FROM guild_settings WHERE guild_id = ${interaction.guild_id}`
      .catch(error => {
        this.logger.warn({ error }, 'Failed a checkMod settings query - returning false');
        return [];
      });

    if (!mod_role) {
      return false;
    }

    return interaction.member.roles.includes(mod_role);
  }

  public checkAdmin(interaction: APIGuildInteraction): boolean {
    return new DiscordPermissions(BigInt(interaction.member.permissions)).has('manageGuild', true);
  }

  public async checkOwner(interaction: APIGuildInteraction): Promise<boolean> {
    const guild = await this.rest.get<RESTGetAPIGuildResult>(Routes.guild(interaction.guild_id)).catch(error => {
      this.logger.warn({ error }, 'Failed a checkOwner guild fetch - returning false');
      return null;
    });

    if (!guild) {
      return false;
    }

    return interaction.member.user.id === guild.owner_id;
  }

  public async check(interaction: APIGuildInteraction, perm: UserPerms): Promise<boolean> {
    switch (perm) {
      case UserPerms.none: return true;
      // Checks are in order of speed (simple bitfield math -> db query + array find -> HTTP call and string comparison)
      case UserPerms.mod: return this.checkAdmin(interaction) || await this.checkMod(interaction) || this.checkOwner(interaction);
      case UserPerms.admin: return this.checkAdmin(interaction) || this.checkOwner(interaction);
      case UserPerms.owner: return this.checkOwner(interaction);
    }
  }
}
