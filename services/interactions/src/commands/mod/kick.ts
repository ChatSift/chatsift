import { injectable } from 'tsyringe';
import { Command } from '../../command';
import { ArgumentsOf, ControlFlowError, dmUser, getGuildName, send } from '#util';
import { PermissionsChecker, UserPerms } from '@automoderator/discord-permissions';
import { KickCommand } from '#interactions';
import { HTTPError, Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import { APIGuildInteraction, InteractionResponseType } from 'discord-api-types/v9';
import { ApiPostGuildsCasesBody, ApiPostGuildsCasesResult, CaseAction, Log, LogTypes } from '@automoderator/core';
import { PubSubPublisher } from '@cordis/brokers';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    public readonly guildLogs: PubSubPublisher<Log>,
    public readonly checker: PermissionsChecker
  ) {}

  public parse(args: ArgumentsOf<typeof KickCommand>) {
    return {
      member: args.user,
      reason: args.reason,
      refId: args.reference
    };
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof KickCommand>) {
    await send(interaction, { flags: 64 }, { type: InteractionResponseType.DeferredChannelMessageWithSource });
    const { member, reason, refId } = this.parse(args);
    if (reason && reason.length >= 1900) {
      throw new ControlFlowError(`Your provided reason is too long (${reason.length}/1900)`);
    }

    if (member.user.id === interaction.member.user.id) {
      throw new ControlFlowError('You cannot kick yourself');
    }

    if (await this.checker.check({ guild_id: interaction.guild_id, member }, UserPerms.mod)) {
      throw new ControlFlowError('You cannot action a member of the staff team');
    }

    const modTag = `${interaction.member.user.username}#${interaction.member.user.discriminator}`;
    const targetTag = `${member.user.username}#${member.user.discriminator}`;

    const guildName = await getGuildName(interaction.guild_id);
    await dmUser(member.user.id, `Hello! You have been kicked from ${guildName}.\n\nReason: ${reason ?? 'No reason provided.'}`);

    try {
      const [cs] = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(`/guilds/${interaction.guild_id}/cases`, [
        {
          action: CaseAction.kick,
          mod_id: interaction.member.user.id,
          mod_tag: modTag,
          target_id: member.user.id,
          target_tag: targetTag,
          reason,
          reference_id: refId,
          created_at: new Date(),
          execute: true
        }
      ]);

      await send(interaction, { content: `Successfully kicked ${targetTag}` }, { update: true });
      this.guildLogs.publish({
        type: LogTypes.modAction,
        data: cs!
      });
    } catch (error) {
      if (error instanceof HTTPError && error.statusCode === 400) {
        return send(interaction, { content: error.message }, { update: true });
      }

      throw error;
    }
  }
}
