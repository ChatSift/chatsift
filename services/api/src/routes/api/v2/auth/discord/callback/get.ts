import { discordOAuth2, State } from '#util';
import { Config, kConfig } from '@automoderator/injection';
import { badRequest } from '@hapi/boom';
import cookie from 'cookie';
import fetch from 'node-fetch';
import type { NextHandler, Request, Response } from 'polka';
import { inject, injectable } from 'tsyringe';
import type { APIUser } from 'discord-api-types/v9';
import { Route, validate } from '@chatsift/rest-utils';
import { userAuth } from '#middleware';
import { GetAuthDiscordCallbackQuerySchema, GetAuthDiscordCallbackQuery } from '@chatsift/api-wrapper/v2';
import { PrismaClient } from '@prisma/client';

@injectable()
export default class extends Route {
	public override readonly middleware = [validate(GetAuthDiscordCallbackQuerySchema, 'query'), userAuth(true)];

	public constructor(@inject(kConfig) public readonly config: Config, public readonly prisma: PrismaClient) {
		super();
	}

	public async handle(req: Request, res: Response, next: NextHandler) {
		const { state: stateQuery } = req.query as GetAuthDiscordCallbackQuery;

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

		const response = await discordOAuth2(req, res, next, `${this.config.apiDomain}/api/v2/auth/discord/callback`);
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

		await this.prisma.user.upsert({
			create: {
				userId: user.id,
				perms: 0n,
			},
			update: {},
			where: {
				userId: user.id,
			},
		});

		res.redirect(state.redirectUri);
		return res.end();
	}
}
