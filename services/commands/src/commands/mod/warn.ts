import { injectable } from 'tsyringe';
import { Command, UserPerms } from '../../command';
import { ArgumentsOf, ControlFlowError, send } from '../../util';
import { WarnCommand } from '../../interactions/mod/warn';
import { Rest } from '@automoderator/http-client';
import { APIGuildInteraction } from 'discord-api-types/v8';
import { ApiPostGuildsCasesBody, ApiPostGuildsCasesResult, CaseAction, Log, LogTypes } from '@automoderator/core';
import { PubSubServer } from '@cordis/brokers';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    public readonly rest: Rest,
    public readonly guildLogs: PubSubServer<Log>
  ) {}

  public parse(args: ArgumentsOf<typeof WarnCommand>) {
    return {
      member: args.user,
      reason: args.reason,
      refId: args.reference
    };
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof WarnCommand>) {
    const { member, reason, refId } = this.parse(args);
    if (reason && reason.length >= 1900) {
      throw new ControlFlowError(`Your provided reason is too long (${reason.length}/1900)`);
    }

    const targetTag = `${member.user.username}#${member.user.discriminator}`;
    const [cs] = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(`/api/v1/guilds/${interaction.guild_id}/cases`, [
      {
        action: CaseAction.warn,
        mod_id: interaction.member.user.id,
        mod_tag: `${interaction.member.user.username}#${interaction.member.user.discriminator}`,
        target_id: member.user.id,
        target_tag: targetTag,
        reason,
        reference_id: refId,
        created_at: new Date()
      }
    ]);

    await send(interaction, { content: `Successfully warned ${targetTag}` });
    this.guildLogs.publish({
      type: LogTypes.modAction,
      data: cs!
    });
  }
}
