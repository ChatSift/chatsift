import { injectable } from 'tsyringe';
import { Command, UserPerms } from '../../command';
import { ArgumentsOf } from '#util';
import { send } from '@automoderator/interaction-util';
import { ReferenceCommand } from '#interactions';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import { PubSubServer } from '@cordis/brokers';
import { ApiPatchGuildsCasesBody, ApiPostGuildsCasesResult, Log, LogTypes } from '@automoderator/core';
import type { APIGuildInteraction } from 'discord-api-types/v8';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    public readonly guildLogs: PubSubServer<Log>
  ) {}

  public parse(args: ArgumentsOf<typeof ReferenceCommand>) {
    return {
      csId: args.case,
      reference: args.reference
    };
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof ReferenceCommand>) {
    const { csId, reference } = this.parse(args);

    const [cs] = await this.rest.patch<ApiPostGuildsCasesResult, ApiPatchGuildsCasesBody>(`/api/v1/guilds/${interaction.guild_id}/cases`, [
      {
        case_id: csId,
        ref_id: reference,
        mod_id: interaction.member.user.id,
        mod_tag: `${interaction.member.user.username}${interaction.member.user.discriminator}`
      }
    ]);

    await send(interaction, { content: 'Successfully updated the reference' });

    this.guildLogs.publish({
      type: LogTypes.modAction,
      data: cs!
    });
  }
}
