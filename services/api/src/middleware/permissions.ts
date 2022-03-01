import { forbidden, unauthorized } from '@hapi/boom';
import type { NextHandler, Request, Response } from 'polka';
import { Permissions, PermissionsResolvable } from '@chatsift/api-wrapper';

export const globalPermissions =
	(required: PermissionsResolvable) => (req: Request, _: Response, next: NextHandler) => {
		if (!req.user && !req.app) {
			return next(unauthorized('missing authorization header', 'Bearer'));
		}

		const perms = new Permissions(BigInt((req.user?.perms ?? req.app?.perms)!));

		if (!perms.has(required)) {
			return next(forbidden('missing permission'));
		}

		return next();
	};
