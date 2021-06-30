import { injectable } from 'tsyringe';
import { Command, UserPerms } from '../../command';
import { ArgumentsOf, ControlFlowError, send } from '../../util';
import { SoftbanCommand } from '../../interactions/mod/softban';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import { APIGuildInteraction, RESTPutAPIGuildBanJSONBody, Routes } from 'discord-api-types/v8';
import { ApiPostGuildsCasesBody, ApiPostGuildsCasesResult, CaseAction, Log, LogTypes } from '@automoderator/core';
import { PubSubServer } from '@cordis/brokers';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    public readonly guildLogs: PubSubServer<Log>
  ) {}

  public parse(args: ArgumentsOf<typeof SoftbanCommand>) {
    return {
      member: args.user,
      reason: args.reason,
      days: args.days ?? 1,
      refId: args.reference
    };
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof SoftbanCommand>) {
    const { member, reason, refId, days } = this.parse(args);
    if (reason && reason.length >= 1900) {
      throw new ControlFlowError(`Your provided reason is too long (${reason.length}/1900)`);
    }

    const modTag = `${interaction.member.user.username}#${interaction.member.user.discriminator}`;
    const targetTag = `${member.user.username}#${member.user.discriminator}`;

    await this.discordRest.put<unknown, RESTPutAPIGuildBanJSONBody>(Routes.guildBan(interaction.guild_id, member.user.id), {
      reason: `Softban | By ${modTag}`,
      data: { delete_message_days: days }
    });

    await this.discordRest.delete(Routes.guildBan(interaction.guild_id, member.user.id), { reason: `Softban | By ${modTag}` });

    const [cs] = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(`/api/v1/guilds/${interaction.guild_id}/cases`, [
      {
        action: CaseAction.softban,
        mod_id: interaction.member.user.id,
        mod_tag: modTag,
        target_id: member.user.id,
        target_tag: targetTag,
        reason,
        reference_id: refId
      }
    ]);

    await send(interaction, { content: `Successfully softbanned ${targetTag}` });
    this.guildLogs.publish({
      type: LogTypes.modAction,
      data: cs!
    });
  }
}
