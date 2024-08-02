import { Env, INJECTION_TOKENS, setEquals } from '@automoderator/core';
import { API } from '@discordjs/core';
import { badRequest, forbidden } from '@hapi/boom';
import { parse as parseCookie } from 'cookie';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { inject, injectable } from 'inversify';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { FastifyServer, Registerable } from '../../server.js';
import { Auth, SCOPES } from '../../struct/Auth.js';
import { StateCookie } from '../../struct/StateCookie.js';
import { discordAuth } from '../../util/discordAuth.js';
import { appendCookie } from '../../util/replyHelpers.js';

@injectable()
export default class DiscordAuth implements Registerable {
	public constructor(
		private readonly env: Env,
		private readonly api: API,
		private readonly auth: Auth,
		@inject(INJECTION_TOKENS.logger) private readonly logger: Logger,
	) {}

	public register(server: FastifyServer) {
		server
			.withTypeProvider<ZodTypeProvider>()
			.route({
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
						client_id: this.env.oauthDiscordClientId,
						redirect_uri: `${this.env.publicApiURL}/auth/discord/callback`,
						response_type: 'code',
						scope: SCOPES,
						state,
					});

					appendCookie(reply, 'state', state, { httpOnly: true, path: '/' });
					await reply.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
				},
			})
			.route({
				method: 'GET',
				url: '/auth/discord/callback',
				schema: {
					querystring: z.object({
						code: z.string(),
						state: z.string(),
					}),
				},
				preHandler: [discordAuth(true)],
				handler: async (request, reply) => {
					const { code, state: stateQuery } = request.query;

					const cookies = parseCookie(request.headers.cookie ?? '');
					if (stateQuery !== cookies.state) {
						throw badRequest('invalid state');
					}

					const state = StateCookie.from(stateQuery);
					appendCookie(reply, 'state', 'noop', { httpOnly: true, path: '/', expires: new Date('1970-01-01') });

					if (request.discordUser) {
						await reply.redirect(state.redirectUri);
						return;
					}

					const result = await this.api.oauth2.tokenExchange({
						client_id: this.env.oauthDiscordClientId,
						client_secret: this.env.oauthDiscordClientSecret,
						code,
						grant_type: 'authorization_code',
						redirect_uri: `${this.env.publicApiURL}/auth/discord/callback`,
					});

					if (!setEquals(new Set(result.scope.split(' ')), new Set(SCOPES.split(' ')))) {
						this.logger.warn({ returnedScopes: result.scope, expectedScopes: SCOPES }, 'miss matched scopes');
						throw forbidden(`Expected scope "${SCOPES}" but received scope "${result.scope}"`);
					}

					const discordUser = await this.auth.fetchDiscordUser(result.access_token);
					const user = await this.auth.loginWithDiscord(discordUser.id, result);

					const credentials = this.auth.createTokens(user.id);
					this.auth.appendAuthCookies(reply, credentials);

					await reply.redirect(state.redirectUri);
				},
			});
	}
}
