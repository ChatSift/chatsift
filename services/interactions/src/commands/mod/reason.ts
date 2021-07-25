import { injectable } from 'tsyringe';
import { Command } from '../../command';
import { ArgumentsOf, send } from '#util';
import { UserPerms } from '@automoderator/discord-permissions';
import { ReasonCommand } from '#interactions';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import { ApiPatchGuildsCasesBody, ApiPostGuildsCasesResult, Log, LogTypes } from '@automoderator/core';
import { PubSubPublisher } from '@cordis/brokers';
import type { APIGuildInteraction } from 'discord-api-types/v9';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    public readonly guildLogs: PubSubPublisher<Log>
  ) {}

  public parse(args: ArgumentsOf<typeof ReasonCommand>) {
    return {
      csId: args.case,
      reason: args.reason
    };
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof ReasonCommand>) {
    const { csId, reason } = this.parse(args);

    const [cs] = await this.rest.patch<ApiPostGuildsCasesResult, ApiPatchGuildsCasesBody>(`/api/v1/guilds/${interaction.guild_id}/cases`, [
      {
        case_id: csId,
        reason,
        mod_id: interaction.member.user.id,
        mod_tag: `${interaction.member.user.username}${interaction.member.user.discriminator}`
      }
    ]);

    await send(interaction, { content: 'Successfully updated the reason' });

    this.guildLogs.publish({
      type: LogTypes.modAction,
      data: cs!
    });
  }
}
