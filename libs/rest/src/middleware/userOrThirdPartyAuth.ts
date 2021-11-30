import type { NextHandler, Request, Response } from 'polka';
import { thirdPartyAuth } from './thirdPartyAuth';
import { userAuth } from './userAuth';

export const userOrThirdPartyAuth = (fallthrough = false) => {
  const authThirdParty = thirdPartyAuth(fallthrough);
  const authUser = userAuth(fallthrough);

  return (req: Request, res: Response, next: NextHandler) => {
    if (!req.headers.authorization || !req.headers.authorization.startsWith('App ')) {
      return authUser(req, res, next);
    }

    return authThirdParty(req, res, next);
  };
};
