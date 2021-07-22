import { inject, injectable } from 'tsyringe';
import { jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import * as Joi from 'joi';
import { CaseAction, ApiPostGuildsCasesBody, Case } from '@automoderator/core';
import { kSql } from '@automoderator/injection';
import { badRequest } from '@hapi/boom';
import type { Request, Response, NextHandler } from 'polka';
import type { Sql } from 'postgres';
import type { Snowflake } from 'discord-api-types/v9';

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
                then: Joi.date(),
                otherwise: Joi.forbidden()
              }),
              reason: Joi.string(),
              mod_id: Joi.string()
                .pattern(/\d{17,20}/)
                .required(),
              mod_tag: Joi.string().required(),
              target_id: Joi.string()
                .pattern(/\d{17,20}/)
                .required(),
              target_tag: Joi.string().required(),
              reference_id: Joi.number(),
              created_at: Joi.date()
            })
        )
        .min(1),
      'body'
    )
  ];

  public constructor(
    @inject(kSql) public readonly sql: Sql<{}>
  ) {
    super();
  }

  private async createCase(sql: Sql<{}>, cs: Omit<Case, 'id' | 'case_id'>) {
    if (cs.ref_id) {
      const [refCs] = await sql<[Case?]>`SELECT * FROM cases WHERE guild_id = ${cs.guild_id} AND case_id = ${cs.ref_id}`;

      if (!refCs) {
        return Promise.reject(`could not find reference case with id ${cs.ref_id}`);
      }
    }

    return sql<[Case]>`
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
        ${cs.guild_id},
        ${cs.log_message_id},
        next_case(${cs.guild_id}),
        ${cs.ref_id},
        ${cs.target_id},
        ${cs.target_tag},
        ${cs.mod_id},
        ${cs.mod_tag},
        ${cs.action_type},
        ${cs.reason},
        ${cs.expires_at},
        ${cs.processed},
        ${cs.created_at}
      ) RETURNING *
    `
      .then(rows => rows[0]);
  }

  public async handle(req: Request, res: Response, next: NextHandler) {
    const { gid } = req.params;
    const casesData = req.body as ApiPostGuildsCasesBody;

    try {
      const cases = await this.sql.begin(async sql => {
        const promises: Promise<Case>[] = [];

        for (const data of casesData) {
          const cs: Omit<Case, 'id' | 'case_id'> = {
            guild_id: gid as Snowflake,
            // Eventual consistency™ - this is set in the logger micro-service when the log is generated
            log_message_id: null,
            ref_id: data.reference_id ?? null,
            target_id: data.target_id,
            target_tag: data.target_tag,
            mod_id: data.mod_id,
            mod_tag: data.mod_tag,
            action_type: data.action,
            reason: data.reason ?? null,
            expires_at: 'expires_at' in data ? (data.expires_at ?? null) : null,
            processed: !('expires_at' in data),
            pardoned_by: null,
            created_at: data.created_at ?? new Date()
          };

          promises.push(this.createCase(sql, cs));
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
