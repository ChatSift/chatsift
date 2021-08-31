import { MuteCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, dmUser, getGuildName, send } from '#util';
import { ApiPostGuildsCasesBody, ApiPostGuildsCasesResult, CaseAction, Log, LogTypes, ms } from '@automoderator/core';
import { PermissionsChecker, UserPerms } from '@automoderator/discord-permissions';
import { HTTPError, Rest } from '@automoderator/http-client';
import { kSql } from '@automoderator/injection';
import { PubSubPublisher } from '@cordis/brokers';
import { Rest as DiscordRest } from '@cordis/rest';
import { APIGuildInteraction, InteractionResponseType } from 'discord-api-types/v9';
import type { Sql } from 'postgres';
import { inject, injectable } from 'tsyringe';
import { Command } from '../../command';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    public readonly guildLogs: PubSubPublisher<Log>,
    public readonly checker: PermissionsChecker,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public parse(args: ArgumentsOf<typeof MuteCommand>) {
    return {
      member: args.user,
      reason: args.reason,
      refId: args.reference,
      duration: args.duration
    };
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof MuteCommand>) {
    await send(interaction, { flags: 64 }, InteractionResponseType.DeferredChannelMessageWithSource);
    const { member, reason, refId, duration: durationString } = this.parse(args);
    if (reason && reason.length >= 1900) {
      throw new ControlFlowError(`Your provided reason is too long (${reason.length}/1900)`);
    }

    if (member.user.id === interaction.member.user.id) {
      throw new ControlFlowError('You cannot mute yourself');
    }

    if (await this.checker.check({ guild_id: interaction.guild_id, member }, UserPerms.mod)) {
      throw new ControlFlowError('You cannot action a member of the staff team');
    }

    let expiresAt: Date | undefined;
    if (durationString) {
      const durationMinutes = Number(durationString);

      if (isNaN(durationMinutes)) {
        const duration = ms(durationString);
        if (!duration) {
          throw new ControlFlowError('Failed to parse the provided duration');
        }

        expiresAt = new Date(Date.now() + duration);
      } else {
        expiresAt = new Date(Date.now() + (durationMinutes * 6e4));
      }
    }

    const modTag = `${interaction.member.user.username}#${interaction.member.user.discriminator}`;
    const targetTag = `${member.user.username}#${member.user.discriminator}`;

    const guildName = await getGuildName(interaction.guild_id);

    const duration = expiresAt ? `. This mute will expire in ${ms(expiresAt.getTime() - Date.now(), true)}` : '';
    await dmUser(member.user.id, `Hello! You have been muted in ${guildName}${duration}.${reason ? `\n\nReason: ${reason}` : ''}`);

    try {
      const [cs] = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(`/guilds/${interaction.guild_id}/cases`, [
        {
          action: CaseAction.mute,
          mod_id: interaction.member.user.id,
          mod_tag: modTag,
          target_id: member.user.id,
          target_tag: targetTag,
          reason,
          reference_id: refId,
          expires_at: expiresAt,
          created_at: new Date(),
          execute: true
        }
      ]);

      await send(interaction, { content: `Successfully muted ${targetTag}` });
      this.guildLogs.publish({
        type: LogTypes.modAction,
        data: cs!
      });
    } catch (error) {
      if (error instanceof HTTPError && error.statusCode === 400) {
        return send(interaction, { content: error.message });
      }

      throw error;
    }
  }
}
