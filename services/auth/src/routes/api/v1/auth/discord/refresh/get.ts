import { discordOAuth2 } from '#util';
import type { AuthGetDiscordRefreshBody } from '@automoderator/core';
import { Config, kConfig } from '@automoderator/injection';
import { jsonParser, Route, validate } from '@automoderator/rest';
import { unauthorized } from '@hapi/boom';
import cookie from 'cookie';
import Joi from 'joi';
import type { NextHandler, Request, Response } from 'polka';
import { inject, injectable } from 'tsyringe';

@injectable()
export default class DiscordRefreshRoute extends Route {
	public override readonly middleware = [
		jsonParser(),
		validate(
			Joi.object()
				.keys({
					refresh_token: Joi.string().required(),
				})
				.optional(),
			'body',
		),
	];

	public constructor(@inject(kConfig) public readonly config: Config) {
		super();
	}

	public async handle(req: Request, res: Response, next: NextHandler): Promise<void> {
		const cookies = cookie.parse(req.headers.cookie ?? '');
		const token = cookies.refresh_token ?? (req.body as AuthGetDiscordRefreshBody | undefined)?.refresh_token;

		if (!token) {
			return next(unauthorized('missing refresh token'));
		}

		const response = await discordOAuth2(req, res, next);
		if (!response) return;

		res.cookie('access_token', response.access_token, {
			expires: new Date(Date.now() + response.expires_in * 1000),
			sameSite: 'strict',
			httpOnly: true,
			domain: this.config.rootDomain.replace(/h?t?t?p?s?:?\/?\/?/, ''),
			path: '/',
		});

		return res.end();
	}
}
