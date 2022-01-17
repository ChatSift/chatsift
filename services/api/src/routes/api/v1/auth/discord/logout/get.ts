import type { AuthGetDiscordLogoutQuery } from '@automoderator/core';
import { Config, kConfig, kSql } from '@automoderator/injection';
import { Route, validate } from '@chatsift/rest-utils';
import type { Request, Response } from 'polka';
import type { Sql } from 'postgres';
import { inject, injectable } from 'tsyringe';
import * as zod from 'zod';
import { userAuth } from '#middleware';

@injectable()
export default class extends Route {
	public override readonly middleware = [
		validate(
			zod.object({
				redirect_uri: zod.string(),
			}),
			'query',
		),
		userAuth(),
	];

	public constructor(@inject(kConfig) public readonly config: Config, @inject(kSql) public readonly sql: Sql<{}>) {
		super();
	}

	public handle(req: Request, res: Response) {
		const { redirect_uri } = req.query as unknown as AuthGetDiscordLogoutQuery;

		res.cookie('access_token', 'noop', {
			expires: new Date('1970-01-01'),
			sameSite: 'strict',
			httpOnly: true,
			domain: this.config.rootDomain.replace(/h?t?t?p?s?:?\/?\/?/, ''),
			path: '/',
		});

		res.cookie('refresh_token', 'noop', {
			expires: new Date('1970-01-01'),
			sameSite: 'strict',
			httpOnly: true,
			domain: this.config.rootDomain.replace(/h?t?t?p?s?:?\/?\/?/, ''),
			path: '/',
		});

		res.redirect(redirect_uri);
		return res.end();
	}
}
