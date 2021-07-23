import { injectable } from 'tsyringe';
import { Command } from '../../command';
import { ArgumentsOf, UserPerms, send } from '#util';
import { PardonCommand } from '#interactions';
import { HTTPError, Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import { ApiPatchGuildsCasesBody, ApiPostGuildsCasesResult, Log, LogTypes } from '@automoderator/core';
import { PubSubServer } from '@cordis/brokers';
import type { APIGuildInteraction } from 'discord-api-types/v9';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    public readonly guildLogs: PubSubServer<Log>
  ) {}

  public parse(args: ArgumentsOf<typeof PardonCommand>) {
    return {
      csId: args.case
    };
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof PardonCommand>) {
    const { csId } = this.parse(args);

    try {
      const [cs] = await this.rest.patch<ApiPostGuildsCasesResult, ApiPatchGuildsCasesBody>(`/api/v1/guilds/${interaction.guild_id}/cases`, [
        {
          case_id: csId,
          pardoned_by: interaction.member.user.id
        }
      ]);

      await send(interaction, { content: 'Successfully pardoned the given case' });
      this.guildLogs.publish({
        type: LogTypes.modAction,
        data: cs!
      });
    } catch (e) {
      if (!(e instanceof HTTPError)) {
        throw e;
      }

      switch (e.statusCode) {
        case 400:
        case 404: {
          return send(interaction, { content: 'Please provide a valid warn case', flags: 64 });
        }

        default: {
          throw e;
        }
      }
    }
  }
}
