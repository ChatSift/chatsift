import {
  ApiPostGuildsCasesBody,
  Case,
  CaseAction,
  CaseData,
  GuildSettings,
  UnmuteRole,
  WarnCaseExtras,
  WarnPunishment,
  WarnPunishmentAction
} from '@automoderator/core';
import { kSql } from '@automoderator/injection';
import { jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import { HTTPError, Rest } from '@cordis/rest';
import { badRequest } from '@hapi/boom';
import {
  APIGuildMember,
  APIRole,
  RESTPatchAPIGuildMemberJSONBody,
  RESTPutAPIGuildBanJSONBody,
  Routes,
  Snowflake
} from 'discord-api-types/v9';
import * as Joi from 'joi';
import type { NextHandler, Request, Response } from 'polka';
import type { Sql } from 'postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export default class PostGuildsCasesRoute extends Route {
  public override readonly middleware = [
    thirdPartyAuth(),
    jsonParser(),
    validate(
      Joi
        .array()
        .items(
          Joi
            .object()
            .keys({
              action: Joi.number()
                .min(CaseAction.warn)
                .max(CaseAction.unban)
                .required(),
              expires_at: Joi.when('action', {
                is: Joi.valid(CaseAction.mute, CaseAction.ban).required(),
                then: Joi.date().allow(null),
                otherwise: Joi.forbidden()
              }),
              delete_message_days: Joi.when('action', {
                is: Joi.valid(CaseAction.ban, CaseAction.softban).required(),
                then: Joi.number().positive()
                  .allow(0)
                  .max(7)
                  .default(0)
              }),
              reason: Joi.string().max(1990),
              mod_id: Joi.when('execute', {
                is: true,
                then: Joi.string().pattern(/\d{17,20}/).required(),
                otherwise: Joi.string().pattern(/\d{17,20}/).optional()
              }),
              mod_tag: Joi.when('execute', {
                is: true,
                then: Joi.string().required(),
                otherwise: Joi.string().optional()
              }),
              target_id: Joi.string()
                .pattern(/\d{17,20}/)
                .required(),
              target_tag: Joi.string().required(),
              reference_id: Joi.number(),
              created_at: Joi.date(),
              execute: Joi.boolean().default(false)
            })
            .and('mod_id', 'mod_tag')
        )
        .min(1),
      'body'
    )
  ];

  public constructor(
    public readonly rest: Rest,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {
    super();
  }

  private async createWarnCase(sql: Sql<{}>, data: CaseData & { guild_id: Snowflake }, cs: Case) {
    const warns = await sql`
        SELECT * FROM cases
        WHERE guild_id = ${data.guild_id}
          AND target_id = ${data.target_id}
          AND action_type = ${CaseAction.warn}
          AND pardoned_by IS NULL
      `
      .then(rows => rows.length);

    let triggeredCs: Case | undefined;
    let updatedCs: Case | undefined;
    let duration: number | undefined;
    let extendedBy: number | undefined;

    const [punishment] = await this.sql<[WarnPunishment?]>`
      SELECT * FROM warn_punishments
      WHERE guild_id = ${data.guild_id}
        AND warns = ${warns}
    `;

    if (punishment) {
      interface ResolvedCases {
        [CaseAction.mute]?: Case;
        [CaseAction.ban]?: Case;
      }

      const cases = await this.sql<[Case?, Case?]>`
        SELECT * FROM cases
        WHERE target_id = ${data.target_id}
          AND processed = false
          AND guild_id = ${data.guild_id}
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

      const baseData = {
        guild_id: data.guild_id,
        mod_id: data.mod_id!,
        mod_tag: data.mod_tag!,
        target_id: data.target_id,
        target_tag: data.target_tag,
        reason: data.reason,
        created_at: new Date(),
        execute: true
      };

      switch (punishment.action_type) {
        case WarnPunishmentAction.mute: {
          const muteCase = cases[CaseAction.mute];

          let expiresAt: Date | null = null;
          if (punishment.duration) {
            extendedBy = muteCase?.expires_at?.getTime();
            duration = (punishment.duration * 6e4) + (extendedBy ?? 0);
            expiresAt = new Date(duration);
          }

          if (muteCase) {
            [updatedCs] = await sql`
              UPDATE cases
              SET expires_at = ${expiresAt}, mod_id = ${data.mod_id!}, mod_tag = ${data.mod_tag!}
              WHERE id = ${muteCase.id}
            `;
          } else {
            triggeredCs = await this.createCase(sql, {
              ...baseData,
              action: CaseAction.mute,
              reference_id: cs.case_id,
              expires_at: expiresAt
            });
          }

          break;
        }

        case WarnPunishmentAction.ban: {
          const banCase = cases[CaseAction.ban];

          let expiresAt: Date | null = null;
          if (punishment.duration) {
            extendedBy = banCase?.expires_at?.getTime();
            duration = (punishment.duration * 6e4) + (extendedBy ?? 0);
            expiresAt = new Date(duration);
          }

          if (banCase) {
            [updatedCs] = await sql`
              UPDATE cases
              SET expires_at = ${expiresAt}, mod_id = ${data.mod_id!}, mod_tag = ${data.mod_tag!}
              WHERE id = ${banCase.id}
            `;
          } else {
            triggeredCs = await this.createCase(sql, {
              ...baseData,
              action: CaseAction.ban,
              reference_id: cs.case_id,
              expires_at: expiresAt
            });
          }

          break;
        }

        case WarnPunishmentAction.kick: {
          await this.createCase(sql, {
            ...baseData,
            action: CaseAction.kick,
            reference_id: cs.case_id
          });

          break;
        }
      }
    }

    const warnCaseData = { ...(cs as Omit<Case, 'action_type'> & { action_type: CaseAction.warn; extra?: WarnCaseExtras }) };

    if (triggeredCs || updatedCs) {
      const triggered = ({
        [CaseAction.kick]: WarnPunishmentAction.kick,
        [CaseAction.mute]: WarnPunishmentAction.mute,
        [CaseAction.ban]: WarnPunishmentAction.ban
      } as const)[(triggeredCs ?? updatedCs)!.action_type as CaseAction.kick | CaseAction.mute | CaseAction.ban];

      warnCaseData.extra = triggered === WarnPunishmentAction.kick
        ? { triggered }
        : { triggered, duration, extendedBy };
    }

    return warnCaseData;
  }

  private async createCase(sql: Sql<{}>, data: CaseData & { guild_id: Snowflake }, settings?: GuildSettings) {
    let member: APIGuildMember | undefined;

    if (data.execute) {
      try {
        switch (data.action) {
          case CaseAction.ban: {
            await this.rest.put<unknown, RESTPutAPIGuildBanJSONBody>(Routes.guildBan(data.guild_id, data.target_id), {
              reason: `Ban | By ${data.mod_tag}`,
              data: { delete_message_days: data.delete_message_days }
            });

            break;
          }

          case CaseAction.kick: {
            await this.rest.delete(Routes.guildMember(data.guild_id, data.target_id), { reason: `Kick | By ${data.mod_tag}` });
            break;
          }

          case CaseAction.mute: {
            if (!settings?.mute_role) {
              return Promise.reject('This server does not have a configured mute role');
            }

            const [existingMuteCase] = await sql<[Case?]>`
              SELECT * FROM cases
              WHERE target_id = ${data.target_id}
                AND action_type = ${CaseAction.mute}
                AND guild_id = ${data.guild_id}
                AND processed = false
            `;

            if (existingMuteCase) {
              return Promise.reject(
                'This user has already been muted. If you wish to update the duration please use the `/duration` command'
              );
            }

            const guildRoles = new Map(
              await this.rest.get<APIRole[]>(`/guilds/${data.guild_id}/roles`)
                .catch(() => [] as APIRole[])
                .then(
                  roles => roles.map(
                    role => [role.id, role]
                  )
                )
            );

            member = await this.rest.get<APIGuildMember>(Routes.guildMember(data.guild_id, data.target_id));
            const roles = member.roles.filter(r => guildRoles.get(r)!.managed).concat([settings.mute_role]);

            await this.rest.patch<unknown, RESTPatchAPIGuildMemberJSONBody>(Routes.guildMember(data.guild_id, data.target_id), {
              data: { roles },
              reason: `Mute | By ${data.mod_tag}`
            });

            break;
          }

          case CaseAction.softban: {
            await this.rest.put<unknown, RESTPutAPIGuildBanJSONBody>(Routes.guildBan(data.guild_id, data.target_id), {
              reason: `Softban | By ${data.mod_tag}`,
              data: { delete_message_days: data.delete_message_days }
            });

            await this.rest.delete(Routes.guildBan(data.guild_id, data.target_id), { reason: `Softban | By ${data.mod_tag}` });

            break;
          }

          case CaseAction.unban: {
            const [existingBanCase] = await sql<[Case?]>`
              SELECT * FROM cases
              WHERE target_id = ${data.target_id}
                AND action_type = ${CaseAction.ban}
                AND guild_id = ${data.guild_id}
                AND (processed = false OR expires_at IS NULL)
            `;

            if (existingBanCase) {
              await sql`
                UPDATE cases
                SET mod_id = ${data.mod_id!}, mod_tag = ${data.mod_tag!}, processed = true
                WHERE id = ${existingBanCase.id}
              `;
            }

            await this.rest.delete(Routes.guildBan(data.guild_id, data.target_id), { reason: `Unban | By ${data.mod_tag}` });

            break;
          }

          case CaseAction.unmute: {
            const [muteCase] = await sql<[Case?]>`
              SELECT * FROM cases
              WHERE target_id = ${data.target_id}
                AND action_type = ${CaseAction.mute}
                AND guild_id = ${data.guild_id}
                AND (processed = false OR expires_at IS NULL)
            `;

            if (!muteCase) {
              return Promise.reject('The user in question is not currently muted');
            }

            const roles = await sql<UnmuteRole[]>`SELECT role_id FROM unmute_roles WHERE case_id = ${muteCase.id}`
              .then(
                rows => rows.map(
                  role => role.role_id
                )
              );

            await this.rest.patch<unknown, RESTPatchAPIGuildMemberJSONBody>(
              Routes.guildMember(muteCase.guild_id, muteCase.target_id), {
                data: { roles },
                reason: `Unmute | By ${data.mod_tag}`
              }
            );

            await sql`
              UPDATE cases
              SET mod_id = ${data.mod_id!}, mod_tag = ${data.mod_tag!}, processed = true
              WHERE id = ${muteCase.id}
            `;

            await sql`DELETE FROM unmute_roles WHERE case_id = ${muteCase.id}`;

            break;
          }

          case CaseAction.warn: break;
        }
      } catch (error) {
        if (error instanceof HTTPError && error.response.status === 403) {
          return Promise.reject('Missing permission to execute this case');
        }

        return Promise.reject(error);
      }
    }

    if (data.reference_id) {
      const [refCs] = await sql<[Case?]>`SELECT * FROM cases WHERE guild_id = ${data.guild_id} AND case_id = ${data.reference_id}`;

      if (!refCs) {
        return Promise.reject(`Could not find reference case with id ${data.reference_id}`);
      }
    }

    const [cs] = await sql<[Case]>`
      INSERT INTO cases (
        guild_id,
        log_message_id,
        case_id,
        ref_id,
        target_id,
        target_tag,
        mod_id,
        mod_tag,
        action_type,
        reason,
        expires_at,
        processed,
        created_at
      ) VALUES (
        ${data.guild_id},
        null,
        next_case(${data.guild_id}),
        ${data.reference_id ?? null},
        ${data.target_id},
        ${data.target_tag},
        ${data.mod_id ?? null},
        ${data.mod_tag ?? null},
        ${data.action},
        ${data.reason ?? null},
        ${'expires_at' in data ? (data.expires_at ?? null) : null},
        ${!('expires_at' in data)},
        ${data.created_at ?? new Date()}
      ) RETURNING *
    `;

    if (member) {
      type SqlNoop<T> = { [K in keyof T]: T[K] };
      const unmuteRoles = member.roles.map<SqlNoop<UnmuteRole>>(role => ({ case_id: cs.id, role_id: role }));
      if (unmuteRoles.length) {
        await this.sql`INSERT INTO unmute_roles ${this.sql(unmuteRoles)}`;
      }
    }

    if (data.action === CaseAction.warn) {
      return this.createWarnCase(sql, data, cs);
    }

    return cs;
  }

  public async handle(req: Request, res: Response, next: NextHandler) {
    const { gid } = req.params as { gid: Snowflake };
    const casesData = req.body as ApiPostGuildsCasesBody;
    const [settings] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${gid}`;

    try {
      const cases = await this.sql.begin(async sql => {
        const promises: Promise<Case>[] = [];

        for (const data of casesData) {
          promises.push(this.createCase(sql, { guild_id: gid, ...data }, settings));
        }

        return Promise.all(promises);
      });

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');

      return res.end(JSON.stringify(cases));
    } catch (error) {
      if (typeof error === 'string') {
        return next(badRequest(error));
      }

      // Internal error - handle on a higher layer
      throw error;
    }
  }
}
