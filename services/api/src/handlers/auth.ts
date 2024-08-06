import { Env, setEquals, API_URL, BOTS, UserMeSchema } from '@chatsift/service-core';
import { API, Routes, type RESTPostOAuth2AccessTokenResult } from '@discordjs/core';
import { makeURLSearchParams } from '@discordjs/rest';
import { badRequest, forbidden } from '@hapi/boom';
import { parse as parseCookie } from 'cookie';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { injectable } from 'inversify';
import { z } from 'zod';
import type { FastifyServer, Registerable } from '../server.js';
import { Auth, SCOPES } from '../struct/Auth.js';
import { StateCookie } from '../struct/StateCookie.js';
import { discordAuth } from '../util/discordAuth.js';
import { appendCookie } from '../util/replyHelpers.js';

@injectable()
export default class DiscordAuthHandler implements Registerable {
	private readonly refererSchema = z
		.string()
		.transform((str) => (str.at(-1) === '/' ? str.slice(0, -1) : str))
		.pipe(z.enum(Env.ALLOWED_API_ORIGINS as [string, ...string[]]));

	public constructor(
		private readonly api: API,
		private readonly auth: Auth,
	) {}

	public register(server: FastifyServer) {
		server
			.withTypeProvider<ZodTypeProvider>()
			.route({
				method: 'GET',
				url: '/auth/discord',
				schema: {
					headers: z.object({
						referer: this.refererSchema,
					}),
					querystring: z
						.object({
							redirect_path: z.string(),
						})
						.strict(),
				},
				preHandler: [discordAuth(true)],
				handler: async (request, reply) => {
					const { referer } = request.headers;
					const { redirect_path } = request.query;

					const redirectURI = this.getRedirectURI(referer, redirect_path);

					if (request.discordUser) {
						await reply.redirect(redirectURI);
						return;
					}

					const state = new StateCookie(redirectURI).toCookie();
					const params = new URLSearchParams({
						client_id: Env.OAUTH_DISCORD_CLIENT_ID,
						redirect_uri: `${API_URL}/auth/discord/callback`,
						response_type: 'code',
						scope: SCOPES,
						state,
					});

					appendCookie(reply, 'state', state, { httpOnly: true, path: '/', domain: `.${Env.ROOT_DOMAIN}` });
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
					appendCookie(reply, 'state', 'noop', {
						httpOnly: true,
						path: '/',
						expires: new Date('1970-01-01'),
						domain: `.${Env.ROOT_DOMAIN}`,
					});

					if (request.discordUser) {
						await reply.redirect(state.redirectURI);
						return;
					}

					const result = (await this.api.rest.post(Routes.oauth2TokenExchange(), {
						auth: false,
						headers: {
							'Content-Type': 'application/x-www-form-urlencoded',
						},
						passThroughBody: true,
						body: makeURLSearchParams({
							client_id: Env.OAUTH_DISCORD_CLIENT_ID,
							client_secret: Env.OAUTH_DISCORD_CLIENT_SECRET,
							code,
							grant_type: 'authorization_code',
							redirect_uri: `${API_URL}/auth/discord/callback`,
						}),
					})) as RESTPostOAuth2AccessTokenResult;

					if (!setEquals(new Set(result.scope.split(' ')), new Set(SCOPES.split(' ')))) {
						request.log.warn({ returnedScopes: result.scope, expectedScopes: SCOPES }, 'miss matched scopes');
						throw forbidden(`Expected scope "${SCOPES}" but received scope "${result.scope}"`);
					}

					const discordUser = await this.auth.fetchDiscordUser(result.access_token);
					const user = await this.auth.loginWithDiscord(discordUser.id, result);

					const credentials = this.auth.createTokens(user.id);
					this.auth.appendAuthCookies(reply, credentials);

					await reply.redirect(state.redirectURI);
				},
			})
			.route({
				method: 'GET',
				url: '/auth/discord/@me',
				schema: {
					response: {
						200: UserMeSchema,
					},
				},
				preHandler: [discordAuth(false)],
				handler: async (request, reply) => {
					const user = request.discordUser!;

					const URLs = [Env.AUTOMODERATOR_GATEWAY_URL];
					const requests = URLs.map(async (url, index) => {
						/* eslint-disable promise/prefer-await-to-callbacks, promise/prefer-await-to-then */
						return fetch(`${url}/guilds`)
							.then(async (response) => response.json())
							.then((json: any) => [new Set(json.guilds as string[]), BOTS[index]!] as const)
							.catch((error) => {
								request.log.error({ err: error }, 'failed to fetch guilds');
								return [new Set<string>(), BOTS[index]!] as const;
							});
						/* eslint-enable promise/prefer-await-to-callbacks, promise/prefer-await-to-then */
					});

					const responses = await Promise.all(requests);

					const guilds = user.guilds.map((guild) => ({
						id: guild.id,
						name: guild.name,
						icon: guild.icon,
						bots: responses.filter(([set]) => set.has(guild.id)).map(([_, botId]) => botId),
					}));

					await reply.send({ avatar: user.avatar, username: user.username, id: user.id, guilds });
				},
			})
			.route({
				method: 'GET',
				url: '/auth/discord/logout',
				schema: {
					headers: z.object({
						referer: this.refererSchema,
					}),
				},
				preHandler: [discordAuth(false)],
				handler: async (request, reply) => {
					this.auth.appendInvalidatedAuthCookies(reply);
					return reply.redirect(request.headers.referer);
				},
			});
	}

	private getRedirectURI(origin: string, redirectPath: string): string {
		const url = new URL(redirectPath, origin);
		return url.toString();
	}
}
