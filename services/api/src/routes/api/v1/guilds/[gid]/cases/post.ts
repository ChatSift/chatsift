import { inject, injectable } from 'tsyringe';
import { jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import * as Joi from 'joi';
import { CaseAction, ApiPostGuildsCasesBody, Case } from '@automoderator/core';
import { kSql } from '@automoderator/injection';
import type { Request, Response } from 'polka';
import type { Sql } from 'postgres';
import type { Snowflake } from 'discord-api-types/v8';

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
              moderator_id: Joi.string()
                .pattern(/\d{17,20}/)
                .required(),
              moderator_tag: Joi.string().required(),
              target_id: Joi.string()
                .pattern(/\d{17,20}/)
                .required(),
              target_tag: Joi.string().required(),
              delete_message_days: Joi.when('action', {
                is: Joi.valid(CaseAction.softban, CaseAction.ban).required(),
                then: Joi.number().positive().allow(0)
                  .max(7)
                  .default(0),
                otherwise: Joi.forbidden()
              }),
              reference_id: Joi.number()
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

  private createCase(cs: Omit<Case, 'id' | 'case_id'>) {
    return this.sql<[Case]>`
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
        ${cs.expires_at}
      ) RETURNING *
    `
      .then(rows => rows[0]);
  }

  public async handle(req: Request, res: Response) {
    const { gid } = req.params;
    const casesData = req.body as ApiPostGuildsCasesBody;

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
        created_at: new Date()
      };

      promises.push(this.createCase(cs));
    }

    const cases = await Promise.all(promises);

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(cases));
  }
}
