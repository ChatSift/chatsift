import fetch from 'node-fetch';
import { unauthorized } from '@hapi/boom';
import cookie from 'cookie';
import type { Request, Response, NextHandler } from 'polka';
import type { APIUser } from 'discord-api-types/v8';

declare module 'polka' {
  export interface Request {
    user?: APIUser;
  }
}

export const userAuth = (fallthrough = false) => async (req: Request, _: Response, next: NextHandler) => {
  const cookies = cookie.parse(req.headers.cookie ?? '');
  const token = cookies.access_token ?? req.headers.authorization;

  if (!token) {
    return next(fallthrough ? undefined : unauthorized('missing authorization header', 'Bearer'));
  }

  const result = await fetch(
    'https://discord.com/api/v8/users/@me', {
      headers: {
        authorization: `Bearer ${token}`
      }
    }
  );

  if (result.ok) {
    req.user = await result.json();
  }

  return next(req.user || fallthrough ? undefined : unauthorized('invalid discord access token'));
};
