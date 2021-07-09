import { injectable, inject } from 'tsyringe';
import { Command } from '../../command';
import { ArgumentsOf } from '#util';
import { UserPerms, ControlFlowError, send } from '@automoderator/interaction-util';
import { UnmuteCommand } from '#interactions';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import { APIGuildInteraction, RESTPatchAPIGuildMemberJSONBody, Routes, Snowflake } from 'discord-api-types/v8';
import { PubSubServer } from '@cordis/brokers';
import { kSql } from '@automoderator/injection';
import {
  ApiPatchGuildsCasesBody,
  ApiPostGuildsCasesBody,
  ApiPostGuildsCasesResult,
  Case,
  CaseAction,
  Log,
  LogTypes,
  UnmuteRole
} from '@automoderator/core';
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

  public parse(args: ArgumentsOf<typeof UnmuteCommand>) {
    return {
      member: args.user,
      reason: args.reason,
      refId: args.reference
    };
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof UnmuteCommand>) {
    const { member, reason, refId } = this.parse(args);
    if (reason && reason.length >= 1900) {
      throw new ControlFlowError(`Your provided reason is too long (${reason.length}/1900)`);
    }

    const modTag = `${interaction.member.user.username}#${interaction.member.user.discriminator}`;
    const targetTag = `${member.user.username}#${member.user.discriminator}`;

    const [muteCase, roles] = await this.sql.begin<[cs: Case | null, roles: Snowflake[]]>(async sql => {
      const [cs] = await sql<[Case?]>`
        SELECT * FROM cases
        WHERE target_id = ${member.user.id}
          AND action_type = ${CaseAction.mute}
          AND guild_id = ${interaction.guild_id}
          AND processed = false
      `;

      if (!cs) {
        return [null, []];
      }

      return [
        cs,
        await sql<UnmuteRole[]>`SELECT role_id FROM unmute_roles WHERE case_id = ${cs.id}`
          .then(
            rows => rows.map(
              role => role.role_id
            )
          )
      ];
    });

    if (!muteCase) {
      throw new ControlFlowError('The user in question is not currently muted');
    }

    await this.discordRest.patch<unknown, RESTPatchAPIGuildMemberJSONBody>(Routes.guildMember(muteCase.guild_id, muteCase.target_id), {
      data: { roles },
      reason: `Unmute | By ${modTag}`
    });

    const [cs] = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(`/api/v1/guilds/${interaction.guild_id}/cases`, [
      {
        action: CaseAction.unmute,
        mod_id: interaction.member.user.id,
        mod_tag: modTag,
        target_id: member.user.id,
        target_tag: targetTag,
        reason,
        reference_id: refId,
        created_at: new Date()
      }
    ]);

    await this.rest.patch<unknown, ApiPatchGuildsCasesBody>(`/api/v1/guilds/${interaction.guild_id}/cases`, [
      {
        case_id: muteCase.case_id,
        mod_id: member.user.id,
        mod_tag: modTag,
        processed: true
      }
    ]);

    await this.sql`DELETE FROM unmute_roles WHERE case_id = ${muteCase.case_id}`;

    await send(interaction, { content: `Successfully unmuted ${targetTag}` });
    this.guildLogs.publish({
      type: LogTypes.modAction,
      data: cs!
    });
  }
}
