/* istanbul ignore file */

import { PrismaClient } from '@prisma/client';
import { unauthorized } from '@hapi/boom';
import cookie from 'cookie';
import type { APIUser } from 'discord-api-types/v9';
import fetch from 'node-fetch';
import type { NextHandler, Request, Response } from 'polka';
import { container } from 'tsyringe';
import { getUserGuilds } from '../util';

declare module 'polka' {
	export interface Request {
		user?: APIUser & { perms: bigint };
	}
}

export const userAuth = (fallthrough = false) => {
	const prisma = container.resolve(PrismaClient);

	return async (req: Request, _: Response, next: NextHandler) => {
		const cookies = cookie.parse(req.headers.cookie ?? '');
		const token = cookies.access_token ?? req.headers.authorization;

		if (!token) {
			return next(fallthrough ? undefined : unauthorized('missing authorization header', 'Bearer'));
		}

		if (token.startsWith('App ')) {
			return next(unauthorized('invalid authorization header. please provide a user token'));
		}

		const result = await fetch('https://discord.com/api/v9/users/@me', {
			headers: {
				authorization: `Bearer ${token}`,
			},
		});

		if (result.ok) {
			const data = (await result.json()) as APIUser;

			req.user = {
				...data,
				perms: (await prisma.user.findFirst({ where: { userId: data.id }, select: { perms: true } }))!.perms,
			};
		}

		if (req.params.gid) {
			const guilds = await getUserGuilds(token);

			if (!guilds.has(req.params.gid)) {
				return next(unauthorized('cannot perform actions on this guild'));
			}
		}

		return next(req.user || fallthrough ? undefined : unauthorized('invalid discord access token'));
	};
};
