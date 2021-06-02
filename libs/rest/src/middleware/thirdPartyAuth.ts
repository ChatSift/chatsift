import { unauthorized, badRequest } from '@hapi/boom';
import { TokenValidationStatus, validateToken } from '../utils';
import type { Request, Response, NextHandler } from 'polka';
import type { App } from '@automoderator/core';

declare module 'polka' {
  export interface Request {
    app?: App;
  }
}

export const thirdPartyAuth = (fallthrough = false) => async (req: Request, _: Response, next: NextHandler) => {
  const { authorization } = req.headers;

  if (!authorization) {
    return next(fallthrough ? undefined : unauthorized('missing authorization header'));
  }

  if (!authorization.startsWith('App ')) {
    return next(unauthorized('invalid authorization header. please provide an application token'));
  }

  const { status, app } = await validateToken(authorization.replace('App ', ''));
  switch (status) {
    case TokenValidationStatus.malformedToken: return next(badRequest('malformed authorization token'));
    case TokenValidationStatus.malformedAppId: return next(badRequest('malformed app id'));
    case TokenValidationStatus.noMatch: return next(fallthrough ? undefined : unauthorized('invalid access token'));
    case TokenValidationStatus.success: {
      req.app = app;
      break;
    }
  }

  return next();
};
