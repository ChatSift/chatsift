import { injectable, inject } from 'tsyringe';
import { Config, kConfig } from '@automoderator/injection';
import { Route, State, userAuth, validate } from '@automoderator/rest';
import * as Joi from 'joi';
import cookie from 'cookie';
import { badRequest } from '@hapi/boom';
import { discordOAuth2 } from '#util';
import type { AuthGetDiscordCallbackQuery } from '@automoderator/core';
import type { Request, Response, NextHandler } from 'polka';

@injectable()
export default class GetDiscordCallbackRoute extends Route {
  public readonly middleware = [
    validate(
      Joi
        .object()
        .keys({
          code: Joi.string().required(),
          state: Joi.string().required()
        })
        .required(),
      'query'
    ),
    userAuth(true)
  ];

  public constructor(
    @inject(kConfig) public readonly config: Config
  ) {
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
    if (!response) return;

    res.cookie('access_token', response.access_token, {
      expires: new Date(Date.now() + (response.expires_in * 1000)),
      sameSite: 'strict',
      httpOnly: true,
      domain: this.config.rootDomain.replace(/h?t?t?p?s?:?\/?\/?/, ''),
      path: '/'
    });

    res.cookie('refresh_token', response.refresh_token, {
      expires: new Date(2030, 1),
      sameSite: 'strict',
      httpOnly: true,
      domain: this.config.rootDomain.replace(/h?t?t?p?s?:?\/?\/?/, ''),
      path: '/'
    });

    res.redirect(state.redirectUri);
    return res.end();
  }
}
