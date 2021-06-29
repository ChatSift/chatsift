import { inject, injectable } from 'tsyringe';
import { jsonParser, Route, thirdPartyAuth, validate } from '@automoderator/rest';
import * as Joi from 'joi';
import { CaseAction, ApiPatchGuildsCasesBody, Case } from '@automoderator/core';
import { kSql } from '@automoderator/injection';
import { notFound, badRequest } from '@hapi/boom';
import type { Request, Response, NextHandler } from 'polka';
import type { Sql } from 'postgres';

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
              case_id: Joi.number().required(),
              mod_id: Joi.string().pattern(/\d{17,20}/),
              mod_tag: Joi.string(),
              expires_at: Joi.date(),
              reason: Joi.string(),
              ref_id: Joi.number()
            })
            .and('mod_id', 'mod_tag')
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

  public async handle(req: Request, res: Response, next: NextHandler) {
    const { gid } = req.params;
    const casesData = req.body as ApiPatchGuildsCasesBody;

    const cases = await this.sql.begin(async sql => {
      const promises: Promise<Case>[] = [];

      for (const data of casesData) {
        const [cs] = await sql<[Pick<Case, 'action_type'>?]>`
          SELECT action_type FROM cases WHERE guild_id = ${gid!} case_id = ${data.case_id}
        `;

        if (!cs) {
          await next(notFound('case not found'));
          return Promise.reject();
        }

        if (data.expires_at && ![CaseAction.mute, CaseAction.ban].includes(cs.action_type)) {
          await next(badRequest('expires_at is unavailable for mutes and bans'));
          return Promise.reject();
        }

        promises.push(
          sql<[Case]>`UPDATE cases SET ${sql(data)} WHERE guild_id = ${gid!} AND case_id = ${data.case_id}`.then(rows => rows[0])
        );
      }

      return Promise.all(promises);
    }).catch(() => null);

    if (!cases) {
      return;
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(cases));
  }
}
