import type { Case } from '@automoderator/core';
import { kSql } from '@automoderator/injection';
import { Route } from '@chatsift/rest-utils';
import { notFound } from '@hapi/boom';
import type { NextHandler, Request, Response } from 'polka';
import type { Sql } from 'postgres';
import { inject, injectable } from 'tsyringe';
import { thirdPartyAuth } from '#middleware';

@injectable()
export default class extends Route {
	public override readonly middleware = [thirdPartyAuth()];

	public constructor(@inject(kSql) public readonly sql: Sql<{}>) {
		super();
	}

	public async handle(req: Request, res: Response, next: NextHandler) {
		const { gid, cid } = req.params;

		const [cs] = await this.sql<[Case?]>`DELETE FROM cases WHERE guild_id = ${gid!} AND case_id = ${cid!} RETURNING *`;
		if (!cs) {
			return next(notFound('case not found'));
		}

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		return res.end(JSON.stringify(cs));
	}
}
