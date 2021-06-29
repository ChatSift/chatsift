import { injectable } from 'tsyringe';
import { Command, UserPerms } from '../../command';
import { ArgumentsOf, ControlFlowError } from '../../util';
import { KickCommand } from '../../interactions/mod/kick';
import { Rest as DiscordRest } from '@cordis/rest';
import { APIGuildInteraction, Routes } from 'discord-api-types/v8';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
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
    const { member, reason } = this.parse(args);
    if (reason && reason.length >= 1900) {
      throw new ControlFlowError(`Your provided reason is too long (${reason.length}/1900)`);
    }

    await this.discordRest.delete(Routes.guildMember(interaction.guild_id, member.user.id));
  }
}
