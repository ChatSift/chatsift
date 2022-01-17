import { ApiPatchGuildsCasesBody, Case, CaseAction } from '@automoderator/core';
import { kSql } from '@automoderator/injection';
import { badRequest, notFound } from '@hapi/boom';
import * as zod from 'zod';
import type { NextHandler, Request, Response } from 'polka';
import type { Sql } from 'postgres';
import { inject, injectable } from 'tsyringe';
import { jsonParser, Route, validate } from '@chatsift/rest-utils';
import { thirdPartyAuth } from '#middleware';

@injectable()
export default class PostGuildsCasesRoute extends Route {
	public override readonly middleware = [
		thirdPartyAuth(),
		jsonParser(),
		validate(
			zod
				.object({
					case_id: zod.number(),
					expires_at: zod.date().nullable(),
					reason: zod.string(),
					ref_id: zod.number(),
					processed: zod.boolean(),
					pardoned_by: zod.string().regex(/\d{17,20}/),
				})
				.and(
					zod
						.object({
							mod_id: zod.string().regex(/\d{17,20}/),
							mod_tag: zod.string(),
						})
						.or(
							zod.object({
								mod_id: zod.never(),
								mod_tag: zod.never(),
							}),
						),
				)
				.array()
				.min(1),
			'body',
		),
	];

	public constructor(@inject(kSql) public readonly sql: Sql<{}>) {
		super();
	}

	public async handle(req: Request, res: Response, next: NextHandler) {
		const { gid } = req.params;
		const casesData = req.body as ApiPatchGuildsCasesBody;

		const cases = await this.sql
			.begin(async (sql) => {
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
					if (
						(data.expires_at || data.processed != null) &&
						![CaseAction.mute, CaseAction.ban].includes(cs.action_type)
					) {
						await next(badRequest('expires_at and processed cannot only be mutated for mutes and bans'));
						return Promise.reject();
					}

					if (data.pardoned_by && cs.action_type !== CaseAction.warn) {
						await next(badRequest('trying to update pardoned_by on non-warn case'));
						return Promise.reject();
					}

					if (data.ref_id) {
						const [refCs] = await sql<[Case?]>`SELECT * FROM cases WHERE guild_id = ${gid!} AND case_id = ${
							data.ref_id
						}`;
						if (!refCs) {
							await next(badRequest(`could not find reference case with id ${data.ref_id}`));
							return Promise.reject();
						}
					}

					promises.push(
						sql<[Case]>`UPDATE cases SET ${sql(data)} WHERE guild_id = ${gid!} AND case_id = ${
							data.case_id
						} RETURNING *`.then((rows) => rows[0]),
					);
				}

				return Promise.all(promises);
			})
			.catch(() => null);

		if (!cases) {
			return;
		}

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		return res.end(JSON.stringify(cases));
	}
}
