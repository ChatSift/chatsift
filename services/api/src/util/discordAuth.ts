import { globalContainer } from '@automoderator/core';
import type { Boom } from '@hapi/boom';
import { forbidden, unauthorized } from '@hapi/boom';
import { parse as parseCookie } from 'cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { Auth, type APIUserWithGuilds } from '../struct/Auth.js';

declare module 'fastify' {
	interface FastifyRequest {
		discordUser?: APIUserWithGuilds;
	}
}

/**
 * Validate the JWT and see if the user's Discord token is still valid
 *
 * @param fallthrough - Whether to carry on if the user is not authenticated
 */
export function discordAuth(fallthrough: boolean) {
	const auth = globalContainer.get(Auth);
	const fail = (boom: Boom) => {
		if (!fallthrough) {
			throw boom;
		}
	};

	return async (request: FastifyRequest, reply: FastifyReply) => {
		const cookies = parseCookie(request.headers.cookie ?? '');
		const token = cookies.access_token ?? request.headers.authorization;

		if (!token) {
			fail(unauthorized('missing authorization', 'Bearer'));
			return;
		}

		try {
			const user = await auth.verifyToken(token);

			try {
				const discordUser = await auth.fetchDiscordUser(user.accessToken);

				// Permission checks
				const match = /guilds\/(?<guildId>\d{17,19})/.exec(request.originalUrl);
				if (match?.groups?.guildId) {
					const guild = discordUser.guilds.find((guild) => guild.id === match?.groups?.guildId);
					if (!guild) {
						throw forbidden('cannot perform actions on this guild');
					}
				}

				request.discordUser = discordUser;
			} catch (error) {
				request.log.error(error, 'discord auth failed');
			}
		} catch (error) {
			if (error instanceof jwt.TokenExpiredError) {
				if (!cookies.refresh_token) {
					fail(unauthorized('expired access token and missing refresh token', 'Bearer'));
					return;
				}

				const newTokens = auth.refreshTokens(token, cookies.refresh_token);
				auth.appendAuthCookies(reply, newTokens);

				const discordUser = await auth.fetchDiscordUser(newTokens.access.token);
				// eslint-disable-next-line require-atomic-updates
				request.discordUser = discordUser;
			} else if (error instanceof jwt.JsonWebTokenError) {
				fail(unauthorized('malformed token', 'Bearer'));
			} else {
				throw error;
			}
		}

		if (!request.discordUser) {
			fail(unauthorized('could not auth with discord'));
		}
	};
}