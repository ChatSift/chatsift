import { discordOAuth2 } from '#util';
import type { AuthGetDiscordCallbackQuery } from '@automoderator/core';
import { Config, kConfig, kSql } from '@automoderator/injection';
import { Route, State, userAuth, validate } from '@automoderator/rest';
import { badRequest } from '@hapi/boom';
import cookie from 'cookie';
import * as Joi from 'joi';
import fetch from 'node-fetch';
import type { NextHandler, Request, Response } from 'polka';
import type { Sql } from 'postgres';
import { inject, injectable } from 'tsyringe';
import type { APIUser } from 'discord-api-types/v9';

@injectable()
export default class GetDiscordCallbackRoute extends Route {
	public override readonly middleware = [
		validate(
			Joi.object()
				.keys({
					code: Joi.string().required(),
					state: Joi.string().required(),
				})
				.required(),
			'query',
		),
		userAuth(true),
	];

	public constructor(@inject(kConfig) public readonly config: Config, @inject(kSql) public readonly sql: Sql<{}>) {
		super();
	}

	public async handle(req: Request, res: Response, next: NextHandler) {
		const { state: stateQuery } = req.query as unknown as AuthGetDiscordCallbackQuery;

		const cookies = cookie.parse(req.headers.cookie ?? '');
		if (stateQuery !== cookies.state) {
			return next(badRequest('invalid state'));
		}

		const state = State.from(stateQuery);
		res.cookie('state', 'noop', { httpOnly: true, path: '/', expires: new Date('1970-01-01') });

		if (req.user) {
			res.redirect(state.redirectUri);
			return res.end();
		}

		const response = await discordOAuth2(req, res, next);
		if (!response) {
			return;
		}

		res.cookie('access_token', response.access_token, {
			expires: new Date(Date.now() + response.expires_in * 1000),
			sameSite: 'strict',
			httpOnly: true,
			domain: this.config.rootDomain.replace(/h?t?t?p?s?:?\/?\/?/, ''),
			path: '/',
		});

		res.cookie('refresh_token', response.refresh_token, {
			expires: new Date(2030, 1),
			sameSite: 'strict',
			httpOnly: true,
			domain: this.config.rootDomain.replace(/h?t?t?p?s?:?\/?\/?/, ''),
			path: '/',
		});

		const user = await fetch('https://discord.com/api/v9/users/@me', {
			headers: {
				authorization: `Bearer ${response.access_token}`,
			},
		}).then((res) => res.json() as Promise<APIUser>);

		await this.sql`INSERT INTO users (user_id, perms) VALUES (${user.id}, 0) ON CONFLICT DO NOTHING`;

		res.redirect(state.redirectUri);
		return res.end();
	}
}
