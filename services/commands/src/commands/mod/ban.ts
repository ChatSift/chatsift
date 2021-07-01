import { injectable } from 'tsyringe';
import { Command, UserPerms } from '../../command';
import { ArgumentsOf, ControlFlowError, send } from '../../util';
import { BanCommand } from '../../interactions/mod/ban';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import { APIGuildInteraction, RESTPutAPIGuildBanJSONBody, Routes } from 'discord-api-types/v8';
import { ApiPostGuildsCasesBody, ApiPostGuildsCasesResult, CaseAction, Log, LogTypes, ms } from '@automoderator/core';
import { PubSubServer } from '@cordis/brokers';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    public readonly guildLogs: PubSubServer<Log>
  ) {}

  public parse(args: ArgumentsOf<typeof BanCommand>) {
    return {
      member: args.user,
      reason: args.reason,
      days: args.days,
      refId: args.reference,
      duration: args.duration
    };
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof BanCommand>) {
    const { member, reason, days, refId, duration: durationString } = this.parse(args);
    if (reason && reason.length >= 1900) {
      throw new ControlFlowError(`Your provided reason is too long (${reason.length}/1900)`);
    }

    let expiresAt: Date | undefined;
    if (durationString) {
      const duration = ms(durationString);
      if (!duration) {
        throw new ControlFlowError('Failed to parse the provided duration');
      }

      expiresAt = new Date(Date.now() + duration);
    }

    const modTag = `${interaction.member.user.username}#${interaction.member.user.discriminator}`;
    const targetTag = `${member.user.username}#${member.user.discriminator}`;

    await this.discordRest.put<unknown, RESTPutAPIGuildBanJSONBody>(Routes.guildBan(interaction.guild_id, member.user.id), {
      reason: `Ban | By ${modTag}`,
      data: { delete_message_days: days }
    });

    const [cs] = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(`/api/v1/guilds/${interaction.guild_id}/cases`, [
      {
        action: CaseAction.ban,
        mod_id: interaction.member.user.id,
        mod_tag: modTag,
        target_id: member.user.id,
        target_tag: targetTag,
        reason,
        reference_id: refId,
        expires_at: expiresAt
      }
    ]);

    await send(interaction, { content: `Successfully banned ${targetTag}` });
    this.guildLogs.publish({
      type: LogTypes.modAction,
      data: cs!
    });
  }
}
