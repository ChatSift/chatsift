import { Permissions, PermissionsResolvable } from '../utils';
import { forbidden, unauthorized } from '@hapi/boom';
import type { Request, Response, NextHandler } from 'polka';

export const permissions = (required: PermissionsResolvable) => (req: Request, _: Response, next: NextHandler) => {
  if (!req.app) {
    return next(unauthorized('missing authorization header', 'Bearer'));
  }

  const perms = new Permissions(BigInt(req.app.perms));

  if (!perms.has(required)) {
    return next(forbidden('missing permission'));
  }

  return next();
};
