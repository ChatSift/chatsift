import type { App } from '@automoderator/core';
import { Config, kConfig, kSql } from '@automoderator/injection';
import { Route } from '@chatsift/rest-utils';
import { badRequest } from '@hapi/boom';
import type { NextHandler, Request, Response } from 'polka';
import type { Sql } from 'postgres';
import { inject, injectable } from 'tsyringe';
import { TokenManager, Permissions } from '#util';

@injectable()
export default class extends Route {
	public constructor(
		@inject(kSql) public readonly sql: Sql<{}>,
		@inject(kConfig) public readonly config: Config,
		public readonly tokens: TokenManager,
	) {
		super();
	}

	public async handle(_: Request, res: Response, next: NextHandler) {
		if (this.config.nodeEnv !== 'dev') {
			return next(badRequest('this route cannot be used in production'));
		}

		const perms = new Permissions('administrator');

		const app = await this.sql.begin(async (sql) => {
			const [existing] = await sql<[App?]>`SELECT * FROM apps WHERE name = 'root'`;

			if (existing) {
				return existing;
			}

			return sql<[App]>`INSERT INTO apps (name, perms) VALUES ('root', ${perms.valueOf().toString()}) RETURNING *`.then(
				(rows) => rows[0],
			);
		});

		const token = await this.tokens.generate(app.app_id);

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		return res.end(JSON.stringify({ token }));
	}
}
