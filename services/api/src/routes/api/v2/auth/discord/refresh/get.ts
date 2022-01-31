import { discordOAuth2 } from '#util';
import { Config, kConfig } from '@automoderator/injection';
import { unauthorized } from '@hapi/boom';
import cookie from 'cookie';
import type { NextHandler, Request, Response } from 'polka';
import { inject, injectable } from 'tsyringe';
import { jsonParser, Route, validate } from '@chatsift/rest-utils';
import { GetAuthDiscordRefreshBodySchema, GetAuthDiscordRefreshBody } from '@chatsift/api-wrapper/v2';

@injectable()
export default class extends Route {
	public override readonly middleware = [jsonParser(), validate(GetAuthDiscordRefreshBodySchema, 'body')];

	public constructor(@inject(kConfig) public readonly config: Config) {
		super();
	}

	public async handle(req: Request, res: Response, next: NextHandler): Promise<void> {
		const cookies = cookie.parse(req.headers.cookie ?? '');
		const token = cookies.refresh_token ?? (req.body as GetAuthDiscordRefreshBody)?.refresh_token;

		if (!token) {
			return next(unauthorized('missing refresh token'));
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

		return res.end();
	}
}
