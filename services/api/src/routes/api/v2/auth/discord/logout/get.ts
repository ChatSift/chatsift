import { Config, kConfig } from '@automoderator/injection';
import { Route, validate } from '@chatsift/rest-utils';
import type { Request, Response } from 'polka';
import { inject, injectable } from 'tsyringe';
import { userAuth } from '#middleware';
import { GetAuthDiscordLogoutQuerySchema, GetAuthDiscordLogoutQuery } from '@chatsift/api-wrapper/v2';

@injectable()
export default class extends Route {
	public override readonly middleware = [validate(GetAuthDiscordLogoutQuerySchema, 'query'), userAuth()];

	public constructor(@inject(kConfig) public readonly config: Config) {
		super();
	}

	public handle(req: Request, res: Response) {
		const { redirect_uri } = req.query as GetAuthDiscordLogoutQuery;

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
