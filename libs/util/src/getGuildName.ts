/* istanbul ignore file */
import { Rest } from '@cordis/rest';
import { APIGuild, Routes, Snowflake } from 'discord-api-types/v9';
import { container } from 'tsyringe';

const GUILD_NAME_CACHE = new Map<Snowflake, string>();
setInterval(() => GUILD_NAME_CACHE.clear(), 9e4).unref();

export const getGuildName = async (guildId: Snowflake) => {
  const rest = container.resolve(Rest);

  const name = GUILD_NAME_CACHE.has(guildId)
    ? GUILD_NAME_CACHE.get(guildId)!
    : await rest.get<APIGuild>(Routes.guild(guildId))
      .then(guild => {
        GUILD_NAME_CACHE.set(guild.id, guild.name);
        return guild.name;
      })
      .catch(() => null);

  return name;
};
