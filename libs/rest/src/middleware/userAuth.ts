import fetch from 'node-fetch';
import { unauthorized } from '@hapi/boom';
import cookie from 'cookie';
import { container } from 'tsyringe';
import { Sql } from 'postgres';
import { kSql } from '@automoderator/injection';
import type { User } from '@automoderator/core';
import type { Request, Response, NextHandler } from 'polka';
import type { APIUser } from 'discord-api-types/v8';

declare module 'polka' {
  export interface Request {
    user?: APIUser & { perms: bigint };
  }
}

export const userAuth = (fallthrough = false) => {
  const sql = container.resolve<Sql<{}>>(kSql);
  return async (req: Request, _: Response, next: NextHandler) => {
    const cookies = cookie.parse(req.headers.cookie ?? '');
    const token = cookies.access_token ?? req.headers.authorization;

    if (!token) {
      return next(fallthrough ? undefined : unauthorized('missing authorization header', 'Bearer'));
    }

    if (token.startsWith('App ')) {
      return next(unauthorized('invalid authorization header. please provide a user token'));
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
      const [{ perms }] = await sql<[Pick<User, 'perms'>]>`SELECT perms FROM users WHERE user_id = ${req.user!.id}`;
      req.user!.perms = perms;
    }

    return next(req.user || fallthrough ? undefined : unauthorized('invalid discord access token'));
  };
};
