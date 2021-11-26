import { DiscordPermissions } from '@automoderator/discord-permissions';
import fetch from 'node-fetch';
import { Routes, APIGuild, Snowflake, RESTGetAPICurrentUserGuildsResult } from 'discord-api-types/v9';
import { container } from 'tsyringe';
import { Rest } from '@cordis/rest';
import type { UserGuild } from '@automoderator/core';

type UserGuilds = Map<Snowflake, UserGuild>;

const GUILDS_CACHE = new Map<string, UserGuilds>();
setInterval(() => GUILDS_CACHE.clear(), 15000);

export const getUserGuilds = async (token: string): Promise<UserGuilds> => {
  if (GUILDS_CACHE.has(token)) {
    return GUILDS_CACHE.get(token)!;
  }

  const guilds: RESTGetAPICurrentUserGuildsResult = await fetch(`https://discord.com/api/v9/users/@me/guilds`, {
    headers: {
      authorization: `Bearer ${token}`
    }
  }).then(res => res.json());

  if (!Array.isArray(guilds)) {
    return new Map();
  }

  const rest = container.resolve(Rest);

  const guildsMap: UserGuilds = new Map(await Promise.all(
    guilds
      .filter(guild => guild.owner || new DiscordPermissions(BigInt(guild.permissions)).has('manageGuild'))
      .map(async g => {
        const guild = await rest.get<APIGuild>(Routes.guild(g.id)).catch(() => null);
        return [g.id, { ...g, data: guild }] as const;
      })
  ));

  GUILDS_CACHE.set(token, guildsMap);
  return guildsMap;
};
