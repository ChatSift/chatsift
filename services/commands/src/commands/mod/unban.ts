import { injectable, inject } from 'tsyringe';
import { Command } from '../../command';
import { ArgumentsOf } from '#util';
import { UserPerms, ControlFlowError, send } from '@automoderator/interaction-util';
import { UnbanCommand } from '#interactions';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import { APIGuildInteraction, Routes } from 'discord-api-types/v8';
import { PubSubServer } from '@cordis/brokers';
import {
  ApiPatchGuildsCasesBody,
  ApiPostGuildsCasesBody,
  ApiPostGuildsCasesResult,
  Case,
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
    public readonly guildLogs: PubSubServer<Log>,
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
    const { member, reason, refId } = this.parse(args);
    if (reason && reason.length >= 1900) {
      throw new ControlFlowError(`Your provided reason is too long (${reason.length}/1900)`);
    }

    const modTag = `${interaction.member.user.username}#${interaction.member.user.discriminator}`;
    const targetTag = `${member.user.username}#${member.user.discriminator}`;

    const [banCase] = await this.sql<[Case?]>`
      SELECT * FROM cases
      WHERE target_id = ${member.user.id}
        AND action_type = ${CaseAction.ban}
        AND guild_id = ${interaction.guild_id}
        AND processed = false
    `;

    await this.discordRest.delete(Routes.guildBan(interaction.guild_id, member.user.id), { reason: `Unban | By ${modTag}` });
    const [cs] = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(`/api/v1/guilds/${interaction.guild_id}/cases`, [
      {
        action: CaseAction.unban,
        mod_id: interaction.member.user.id,
        mod_tag: modTag,
        target_id: member.user.id,
        target_tag: targetTag,
        reason,
        reference_id: refId,
        created_at: new Date()
      }
    ]);

    if (banCase) {
      await this.rest.patch<unknown, ApiPatchGuildsCasesBody>(`/api/v1/guilds/${interaction.guild_id}/cases`, [
        {
          case_id: banCase.case_id,
          mod_id: member.user.id,
          mod_tag: modTag,
          processed: true
        }
      ]);
    }

    await send(interaction, { content: `Successfully unbanned ${targetTag}` });
    this.guildLogs.publish({
      type: LogTypes.modAction,
      data: cs!
    });
  }
}
