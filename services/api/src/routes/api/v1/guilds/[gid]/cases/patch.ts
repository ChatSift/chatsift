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
              expires_at: Joi.date().allow(null),
              reason: Joi.string(),
              ref_id: Joi.number(),
              processed: Joi.boolean()
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
          SELECT action_type FROM cases WHERE guild_id = ${gid!} AND case_id = ${data.case_id}
        `;

        if (!cs) {
          await next(notFound('case not found'));
          return Promise.reject();
        }

        // eslint-disable-next-line no-eq-null
        if ((data.expires_at || data.processed != null) && ![CaseAction.mute, CaseAction.ban].includes(cs.action_type)) {
          await next(badRequest('expires_at and processed cannot only be mutated for mutes and bans'));
          return Promise.reject();
        }

        if (data.ref_id) {
          const [refCs] = await sql<[Case?]>`SELECT * FROM cases WHERE guild_id = ${gid!} AND case_id = ${data.ref_id}`;
          if (!refCs) {
            await next(badRequest(`could not find reference case with id ${data.ref_id}`));
            return Promise.reject();
          }
        }

        promises.push(
          sql<[Case]>`UPDATE cases SET ${sql(data)} WHERE guild_id = ${gid!} AND case_id = ${data.case_id} RETURNING *`.then(rows => rows[0])
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
