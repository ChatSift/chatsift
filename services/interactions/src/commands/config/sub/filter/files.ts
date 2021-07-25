import { inject, singleton } from 'tsyringe';
import { Command } from '../../../../command';
import { ArgumentsOf, send } from '#util';
import { FilterCommand } from '#interactions';
import { kSql } from '@automoderator/injection';
import { Rest as DiscordRest } from '@cordis/rest';
import { HTTPError, Rest } from '@automoderator/http-client';
import type { APIGuildInteraction } from 'discord-api-types/v9';
import type { ApiPutGuildsFiltersFilesBody, ApiDeleteGuildsFiltersFilesBody, ApiGetGuildsFiltersFilesResult } from '@automoderator/core';
import type { Sql } from 'postgres';

@singleton()
export class FilesConfig implements Command {
  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  private handleHttpError(interaction: APIGuildInteraction, error: HTTPError) {
    switch (error.statusCode) {
      case 404: {
        return send(interaction, { content: 'None of the given files were on the list' });
      }

      default: {
        throw error;
      }
    }
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof FilterCommand>['files']) {
    switch (Object.keys(args)[0] as keyof typeof args) {
      case 'add': {
        await this.rest.put<unknown, ApiPutGuildsFiltersFilesBody>(
          `/api/v1/guilds/${interaction.guild_id}/filters/files`,
          args.add.hashes.split(',')
        );

        return send(interaction, { content: 'Successfully added the given file hashes to the filter list' });
      }

      case 'remove': {
        try {
          await this.rest.delete<unknown, ApiDeleteGuildsFiltersFilesBody>(
            `/api/v1/guilds/${interaction.guild_id}/filters/files`,
            args.remove.hashes.split(',')
          );

          return send(interaction, { content: 'Successfully removed the given file hashes from the filter list' });
        } catch (error) {
          if (!(error instanceof HTTPError)) {
            throw error;
          }

          return this.handleHttpError(interaction, error);
        }
      }

      case 'list': {
        const files = await this.rest.get<ApiGetGuildsFiltersFilesResult>(`/api/v1/guilds/${interaction.guild_id}/filters/files`);

        if (!files.length) {
          return send(interaction, { content: 'There is currently nothing on your filter list' });
        }

        const content = files.map(file => file.file_hash).join('\n');

        return send(interaction, {
          content: 'Here\'s your list',
          files: [{ name: 'file-hashes.txt', content: Buffer.from(content) }]
        });
      }
    }
  }
}
