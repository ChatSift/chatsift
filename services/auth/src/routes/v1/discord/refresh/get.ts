import cookie from 'cookie';
import { inject, injectable } from 'tsyringe';
import { Route, validate, jsonParser } from '@automoderator/rest';
import Joi from 'joi';
import { Config, kConfig } from '@automoderator/injection';
import { unauthorized } from '@hapi/boom';
import { discordOAuth2 } from '#util';
import type { AuthGetDiscordRefreshBody } from '@automoderator/core';
import type { Request, Response, NextHandler } from 'polka';

@injectable()
export default class DiscordRefreshRoute extends Route {
  public readonly middleware = [
    jsonParser(),
    validate(
      Joi
        .object()
        .keys({
          refresh_token: Joi.string().required()
        }),
      'body'
    )
  ];

  public constructor(@inject(kConfig) public readonly config: Config) {
    super();
  }

  public async handle(req: Request, res: Response, next: NextHandler): Promise<void> {
    const response = await discordOAuth2(req, res, next);
    if (!response) return;

    const cookies = cookie.parse(req.headers.cookie ?? '');
    const token = cookies.refresh_token ?? (req.body as AuthGetDiscordRefreshBody | undefined)?.refresh_token;

    if (!token) {
      return next(unauthorized('missing refresh token'));
    }

    res.cookie('access_token', response.access_token, {
      expires: new Date(Date.now() + (response.expires_in * 1000)),
      sameSite: 'strict',
      httpOnly: true,
      domain: this.config.rootDomain.replace(/h?t?t?p?s?:?\/?\/?/, ''),
      path: '/'
    });

    return res.end();
  }
}
