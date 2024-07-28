import { Env } from '@automoderator/core';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { injectable } from 'inversify';
import { z } from 'zod';
import type { FastifyServer, Registerable } from '../../server.js';
import { SCOPES } from '../../struct/Auth.js';
import { StateCookie } from '../../struct/StateCookie.js';
import { discordAuth } from '../../util/discordAuth.js';
import { appendCookie } from '../../util/replyHelpers.js';

@injectable()
export default class DiscordAuth implements Registerable {
	public constructor(private readonly env: Env) {}

	public register(server: FastifyServer) {
		server.withTypeProvider<ZodTypeProvider>().route({
			method: 'GET',
			url: '/auth/discord',
			schema: {
				querystring: z.object({
					redirect_uri: z.string().regex(this.env.allowedApiRedirects),
				}),
			},
			preHandler: [discordAuth(true)],
			handler: async (request, reply) => {
				const { redirect_uri } = request.query;

				if (request.discordUser) {
					await reply.redirect(redirect_uri);
					return;
				}

				const state = new StateCookie(redirect_uri).toCookie();
				const params = new URLSearchParams({
					client_id: this.env.discordClientId,
					redirect_uri: `${this.env.publicApiURL}/auth/discord/callback`,
					response_type: 'code',
					scope: SCOPES,
					state,
				});

				appendCookie(reply, 'state', state, { httpOnly: true, path: '/' });
				await reply.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
			},
		});
	}
}
