import { App, PrismaClient } from '@prisma/client';
import { badRequest, unauthorized } from '@hapi/boom';
import type { NextHandler, Request, Response } from 'polka';
import { container } from 'tsyringe';
import { TokenManager, TokenValidationStatus } from '#util';
import { Permissions } from '@chatsift/api-wrapper';

declare module 'polka' {
	export interface Request {
		app?: App;
	}
}

export const thirdPartyAuth = (fallthrough = false) => {
	const tokens = container.resolve(TokenManager);
	const prisma = container.resolve(PrismaClient);

	return async (req: Request, _: Response, next: NextHandler) => {
		const { authorization } = req.headers;

		if (!authorization) {
			return next(fallthrough ? undefined : unauthorized('missing authorization header'));
		}

		if (!authorization.startsWith('App ')) {
			return next(unauthorized('invalid authorization header. please provide an application token'));
		}

		const { status, app } = await tokens.validate(authorization.replace('App ', ''));
		switch (status) {
			case TokenValidationStatus.malformedToken:
				return next(badRequest('malformed authorization token'));
			case TokenValidationStatus.malformedAppId:
				return next(badRequest('malformed app id'));
			case TokenValidationStatus.noMatch:
				return next(fallthrough ? undefined : unauthorized('invalid access token'));
			case TokenValidationStatus.success: {
				req.app = app;
				break;
			}
		}

		if (req.params.gid && !new Permissions(BigInt(req.app!.perms)).has('administrator')) {
			const guild = await prisma.appGuild.findFirst({ where: { appId: app!.appId, guildId: req.params.gid } });

			if (!guild) {
				return next(unauthorized('cannot perform actions on this guild'));
			}
		}

		return next();
	};
};
