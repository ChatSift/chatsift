import { inject, injectable } from 'tsyringe';
import { Command } from '../../command';
import { ArgumentsOf, UserPerms, ControlFlowError, send } from '#util';
import { WarnCommand } from '#interactions';
import { Rest } from '@automoderator/http-client';
import { APIGuildInteraction, Routes } from 'discord-api-types/v9';
import { ApiPatchGuildsCasesBody, ApiPostGuildsCasesBody, ApiPostGuildsCasesResult, Case, CaseAction, HttpCase, Log, LogTypes, WarnPunishment, WarnPunishmentAction } from '@automoderator/core';
import { PubSubServer } from '@cordis/brokers';
import { kSql } from '@automoderator/injection';
import { Rest as DiscordRest } from '@cordis/rest';
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

    const modTag = `${interaction.member.user.username}#${interaction.member.user.discriminator}`;
    const targetTag = `${member.user.username}#${member.user.discriminator}`;

    const [cs] = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(`/api/v1/guilds/${interaction.guild_id}/cases`, [
      {
        action: CaseAction.warn,
        mod_id: interaction.member.user.id,
        mod_tag: modTag,
        target_id: member.user.id,
        target_tag: targetTag,
        reason,
        reference_id: refId,
        created_at: new Date()
      }
    ]);

    const warns = await this
      .sql`
        SELECT * FROM cases
        WHERE guild_id = ${interaction.guild_id}
          AND target_id = ${member.user.id}
          AND action_type = ${CaseAction.warn}
          AND pardoned_by IS NULL
      `
      .then(rows => rows.length);

    let updatedCs: HttpCase | undefined;

    const [punishment] = await this.sql<[WarnPunishment?]>`
        SELECT * FROM warn_punishments
        WHERE guild_id = ${interaction.guild_id}
          AND warns = ${warns}
      `;

    if (punishment) {
      interface ResolvedCases {
        [CaseAction.mute]?: Case;
        [CaseAction.ban]?: Case;
      }

      const cases = await this.sql<[Case?, Case?]>`
          SELECT * FROM cases
          WHERE target_id = ${member.user.id}
            AND processed = false
            AND guild_id = ${interaction.guild_id}
        `
        .then(
          rows => rows.reduce<ResolvedCases>(
            (acc, cs) => {
              if (cs) {
                acc[cs.action_type as CaseAction.mute | CaseAction.ban] = cs;
              }

              return acc;
            }, {}
          )
        );

      switch (punishment.action_type) {
        case WarnPunishmentAction.mute: {
          const muteCase = cases[CaseAction.mute];

          const expiresAt = punishment.duration
            ? new Date(
              (punishment.duration * 6e4) + (muteCase?.expires_at?.getTime() ?? 0)
            )
            : null;

          if (muteCase) {
            [updatedCs] = await this.rest.patch<ApiPostGuildsCasesResult, ApiPatchGuildsCasesBody>(
              `/api/v1/guilds/${interaction.guild_id}/cases`, [
                {
                  case_id: muteCase.id,
                  expires_at: expiresAt,
                  mod_id: interaction.member.user.id,
                  mod_tag: modTag
                }
              ]
            );
          } else {
            await this.rest.post<unknown, ApiPostGuildsCasesBody>(`/api/v1/guilds/${interaction.guild_id}/cases`, [
              {
                action: CaseAction.mute,
                mod_id: interaction.member.user.id,
                mod_tag: modTag,
                target_id: member.user.id,
                target_tag: targetTag,
                reason,
                reference_id: cs!.case_id,
                expires_at: expiresAt,
                created_at: new Date()
              }
            ]);
          }

          break;
        }

        case WarnPunishmentAction.ban: {
          const banCase = cases[CaseAction.ban];

          const expiresAt = punishment.duration
            ? new Date(
              (punishment.duration * 6e4) + (banCase?.expires_at?.getTime() ?? 0)
            )
            : null;

          if (banCase) {
            [updatedCs] = await this.rest.patch<ApiPostGuildsCasesResult, ApiPatchGuildsCasesBody>(
              `/api/v1/guilds/${interaction.guild_id}/cases`, [
                {
                  case_id: banCase.id,
                  expires_at: expiresAt,
                  mod_id: interaction.member.user.id,
                  mod_tag: modTag
                }
              ]
            );
          } else {
            await this.rest.post<unknown, ApiPostGuildsCasesBody>(`/api/v1/guilds/${interaction.guild_id}/cases`, [
              {
                action: CaseAction.ban,
                mod_id: interaction.member.user.id,
                mod_tag: modTag,
                target_id: member.user.id,
                target_tag: targetTag,
                reason,
                reference_id: cs!.case_id,
                expires_at: expiresAt,
                created_at: new Date()
              }
            ]);
          }

          break;
        }

        case WarnPunishmentAction.kick: {
          await this.discordRest.delete(Routes.guildMember(interaction.guild_id, member.user.id), { reason: `Kick | By ${modTag}` });
          break;
        }
      }
    }

    await send(interaction, { content: `Successfully warned ${targetTag}` });
    this.guildLogs.publish({
      type: LogTypes.modAction,
      data: cs!
    });

    if (updatedCs) {
      this.guildLogs.publish({ type: LogTypes.modAction, data: updatedCs });
    }
  }
}
