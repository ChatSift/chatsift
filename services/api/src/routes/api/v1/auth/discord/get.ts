import type { AuthGetDiscordQuery } from '@automoderator/core';
import { Config, kConfig } from '@automoderator/injection';
import * as zod from 'zod';
import type { Request, Response } from 'polka';
import { inject, injectable } from 'tsyringe';
import { URLSearchParams } from 'url';
import { Route, validate } from '@chatsift/rest-utils';
import { userAuth } from '#middleware';
import { State } from '#util';

@injectable()
export default class extends Route {
	public override readonly middleware = [
		validate(
			zod.object({
				redirect_uri: zod.string(),
			}),
			'query',
		),
		userAuth(true),
	];

	public constructor(@inject(kConfig) public readonly config: Config) {
		super();
	}

	public handle(req: Request, res: Response) {
		const { redirect_uri } = req.query as unknown as AuthGetDiscordQuery;

		if (req.user) {
			res.redirect(redirect_uri);
			return res.end();
		}

		const state = new State(redirect_uri).toString();

		const params = new URLSearchParams({
			client_id: this.config.discordClientId,
			redirect_uri: `${this.config.apiDomain}/api/v1/auth/discord/callback`,
			response_type: 'code',
			scope: this.config.discordScopes,
			state,
		});

		res.cookie('state', state, { httpOnly: true, path: '/' });
		res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
		return res.end();
	}
}
