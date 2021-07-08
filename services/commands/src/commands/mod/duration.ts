import { injectable } from 'tsyringe';
import { Command, UserPerms } from '../../command';
import { ArgumentsOf } from '#util';
import { ControlFlowError, send } from '@automoderator/interaction-util';
import { DurationCommand } from '#interactions';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import { ApiPatchGuildsCasesBody, ApiPostGuildsCasesResult, Log, LogTypes, ms } from '@automoderator/core';
import { PubSubServer } from '@cordis/brokers';
import type { APIGuildInteraction } from 'discord-api-types/v8';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    public readonly guildLogs: PubSubServer<Log>
  ) {}

  public parse(args: ArgumentsOf<typeof DurationCommand>) {
    return {
      csId: args.case,
      duration: args.duration
    };
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof DurationCommand>) {
    const { csId, duration: durationString } = this.parse(args);

    const duration = ms(durationString);
    if (!duration) {
      throw new ControlFlowError('Failed to parse the provided duration');
    }

    const expiresAt = new Date(Date.now() + duration);

    const [cs] = await this.rest.patch<ApiPostGuildsCasesResult, ApiPatchGuildsCasesBody>(`/api/v1/guilds/${interaction.guild_id}/cases`, [
      {
        case_id: csId,
        expires_at: expiresAt,
        mod_id: interaction.member.user.id,
        mod_tag: `${interaction.member.user.username}${interaction.member.user.discriminator}`
      }
    ]);

    await send(interaction, { content: 'Successfully updated the duration' });

    this.guildLogs.publish({
      type: LogTypes.modAction,
      data: cs!
    });
  }
}
