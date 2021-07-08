import { basename, extname } from 'path';
import { container } from 'tsyringe';
import { kLogger, kSql } from '@automoderator/injection';
import { Sql } from 'postgres';
import { DiscordPermissions } from '@automoderator/discord-permissions';
import { Rest } from '@cordis/rest';
import { APIGuildInteraction, RESTGetAPIGuildResult, Routes } from 'discord-api-types/v8';
import type { GuildSettings } from '@automoderator/core';
import type { Logger } from 'pino';

export enum UserPerms {
  none,
  mod,
  admin,
  owner
}

const checkMod = async (interaction: APIGuildInteraction): Promise<boolean> => {
  const sql = container.resolve<Sql<{}>>(kSql);
  const [
    { mod_role } = { mod_role: null }
  ] = await sql<[Pick<GuildSettings, 'mod_role'>?]>`SELECT mod_role FROM guild_settings WHERE guild_id = ${interaction.guild_id}`;

  if (!mod_role) {
    return false;
  }

  return interaction.member.roles.includes(mod_role);
};

const checkAdmin = (interaction: APIGuildInteraction): boolean =>
  new DiscordPermissions(BigInt(interaction.member.permissions)).has('manageGuild', true);

const checkOwner = async (interaction: APIGuildInteraction): Promise<boolean> => {
  const rest = container.resolve(Rest);
  const logger = container.resolve<Logger>(kLogger);

  const guild = await rest.get<RESTGetAPIGuildResult>(Routes.guild(interaction.guild_id)).catch(error => {
    logger.warn({ error }, 'Failed a checkOwner guild fetch - returning false');
    return null;
  });

  if (!guild) {
    return false;
  }

  return interaction.member.user.id === guild.owner_id;
};

export const checkPerm = async (interaction: APIGuildInteraction, perm: UserPerms): Promise<boolean> => {
  switch (perm) {
    case UserPerms.none: return true;
    // Checks are in order of speed (simple bitfield math -> db query + array find -> HTTP call and string comparison)
    case UserPerms.mod: return checkAdmin(interaction) || await checkMod(interaction) || checkOwner(interaction);
    case UserPerms.admin: return checkAdmin(interaction) || checkOwner(interaction);
    case UserPerms.owner: return checkOwner(interaction);
  }
};

export interface Command {
  name?: string;
  userPermissions?: UserPerms;
  exec(message: APIGuildInteraction, args: unknown): unknown;
}

export interface CommandInfo {
  name: string;
}

export const commandInfo = (path: string): CommandInfo | null => {
  if (extname(path) !== '.js') {
    return null;
  }

  return {
    name: basename(path, '.js')
  };
};
