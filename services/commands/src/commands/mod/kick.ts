import { injectable } from 'tsyringe';
import { Command, UserPerms } from '../../command';
import { ArgumentsOf, ControlFlowError, send } from '../../util';
import { KickCommand } from '../../interactions/mod/kick';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import { APIGuildInteraction, Routes } from 'discord-api-types/v8';
import { ApiPostGuildsCasesBody, ApiPostGuildsCasesResult, CaseAction } from '@automoderator/core';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest
  ) {}

  public parse(args: ArgumentsOf<typeof KickCommand>) {
    return {
      member: args.user,
      reason: args.reason,
      refId: args.reference
    };
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof KickCommand>) {
    const { member, reason, refId } = this.parse(args);
    if (reason && reason.length >= 1900) {
      throw new ControlFlowError(`Your provided reason is too long (${reason.length}/1900)`);
    }

    await this.discordRest.delete(Routes.guildMember(interaction.guild_id, member.user.id));
    await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(`/api/v1/guilds/${interaction.guild_id}/cases`, [
      {
        action: CaseAction.kick,
        mod_id: interaction.member.user.id,
        mod_tag: `${interaction.member.user.username}#${interaction.member.user.discriminator}`,
        target_id: member.user.id,
        target_tag: `${member.user.username}#${member.user.discriminator}`,
        reason,
        reference_id: refId
      }
    ]);

    // TODO log
    await send(interaction, { content: `Successfully kicked ${member.user.username}#${member.user.discriminator}` });
  }
}
