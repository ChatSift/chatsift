import type { AuthGetDiscordQuery } from '@automoderator/core';
import { Config, kConfig } from '@automoderator/injection';
import { Route, State, userAuth, validate } from '@automoderator/rest';
import * as Joi from 'joi';
import type { Request, Response } from 'polka';
import { inject, injectable } from 'tsyringe';
import { URLSearchParams } from 'url';

@injectable()
export default class GetDiscordRoute extends Route {
  public override readonly middleware = [
    validate(
      Joi
        .object()
        .keys({
          redirect_uri: Joi.string().required()
        })
        .required(),
      'query'
    ),
    userAuth(true)
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
      redirect_uri: `${this.config.authDomain}/api/v1/auth/discord/callback`,
      response_type: 'code',
      scope: this.config.discordScopes,
      state
    });

    res.cookie('state', state, { httpOnly: true, path: '/' });
    res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
    return res.end();
  }
}
