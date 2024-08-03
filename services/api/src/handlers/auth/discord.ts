import { Env, setEquals } from '@automoderator/core';
import { API } from '@discordjs/core';
import { badRequest, forbidden } from '@hapi/boom';
import { SnowflakeRegex } from '@sapphire/discord-utilities';
import { parse as parseCookie } from 'cookie';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { injectable } from 'inversify';
import { z } from 'zod';
import type { FastifyServer, Registerable } from '../../server.js';
import { Auth, SCOPES } from '../../struct/Auth.js';
import { StateCookie } from '../../struct/StateCookie.js';
import { discordAuth } from '../../util/discordAuth.js';
import { appendCookie } from '../../util/replyHelpers.js';

@injectable()
export default class DiscordAuthHandler implements Registerable {
	private readonly botList = ['automoderator'] as const;

	private readonly refererSchema = z
		.string()
		.transform((str) => (str.at(-1) === '/' ? str.slice(0, -1) : str))
		.pipe(z.enum(this.env.allowedAPIOrigins));

	public constructor(
		private readonly env: Env,
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
					querystring: z.object({
						redirect_path: z.string(),
					}),
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
						await reply.redirect(state.redirectURI);
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
						200: z.object({
							avatar: z.string().nullable(),
							username: z.string(),
							id: z.string().regex(SnowflakeRegex),
							guilds: z.array(
								z.object({
									id: z.string().regex(SnowflakeRegex),
									icon: z.string().nullable(),
									name: z.string(),
									bots: z.array(z.enum(this.botList)),
								}),
							),
						}),
					},
				},
				preHandler: [discordAuth(false)],
				handler: async (request, reply) => {
					const user = request.discordUser!;

					const URLs = [this.env.automoderatorGatewayURL];
					const requests = URLs.map(async (url, index) => {
						/* eslint-disable promise/prefer-await-to-callbacks, promise/prefer-await-to-then */
						return fetch(`${url}/guilds`)
							.then(async (response) => response.json())
							.then((json: any) => [new Set(json.guilds as string[]), this.botList[index]!] as const)
							.catch((error) => {
								request.log.error({ err: error }, 'failed to fetch guilds');
								return [new Set<string>(), this.botList[index]!] as const;
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
