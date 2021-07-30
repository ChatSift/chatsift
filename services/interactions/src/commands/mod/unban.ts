import { injectable, inject } from 'tsyringe';
import { Command } from '../../command';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import { UserPerms } from '@automoderator/discord-permissions';
import { UnbanCommand } from '#interactions';
import { HTTPError, Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import { APIGuildInteraction, InteractionResponseType } from 'discord-api-types/v9';
import { PubSubPublisher } from '@cordis/brokers';
import {
  ApiPostGuildsCasesBody,
  ApiPostGuildsCasesResult,
  CaseAction,
  Log,
  LogTypes
} from '@automoderator/core';
import { kSql } from '@automoderator/injection';
import type { Sql } from 'postgres';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    public readonly guildLogs: PubSubPublisher<Log>,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public parse(args: ArgumentsOf<typeof UnbanCommand>) {
    return {
      member: args.user,
      reason: args.reason,
      refId: args.reference
    };
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof UnbanCommand>) {
    await send(interaction, { flags: 64 }, { type: InteractionResponseType.DeferredChannelMessageWithSource });
    const { member, reason, refId } = this.parse(args);
    if (reason && reason.length >= 1900) {
      throw new ControlFlowError(`Your provided reason is too long (${reason.length}/1900)`);
    }

    const modTag = `${interaction.member.user.username}#${interaction.member.user.discriminator}`;
    const targetTag = `${member.user.username}#${member.user.discriminator}`;

    try {
      const [cs] = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(`/guilds/${interaction.guild_id}/cases`, [
        {
          action: CaseAction.unban,
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

      await send(interaction, { content: `Successfully unbanned ${targetTag}` }, { update: true });
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
