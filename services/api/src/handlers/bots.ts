import { BotKindSchema, BOTS, ConfigSchema, type BotId, type Config } from '@chatsift/service-core';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { injectable } from 'inversify';
import { z } from 'zod';
import type { FastifyServer, Registerable } from '../server.js';

@injectable()
export default class BotsDataHandler implements Registerable {
	private readonly data: Record<BotId, Omit<Config, 'bot'>> = {
		automoderator: {
			modules: [
				{
					meta: {
						label: 'Logging',
						description: 'Set up logging for your server',
					},
					kind: 'webhook',
					options: [
						{
							meta: {
								label: 'Mod Logs',
								description: 'Log moderation actions',
							},
						},
					],
				},
			],
		},
	};

	public register(server: FastifyServer) {
		server
			.withTypeProvider<ZodTypeProvider>()
			.route({
				method: 'GET',
				url: '/bots',
				schema: {
					response: {
						200: z.array(BotKindSchema).readonly(),
					},
				},
				handler: async (_, reply) => {
					await reply.send(BOTS);
				},
			})
			.route({
				method: 'GET',
				url: '/bots/:bot',
				schema: {
					params: z
						.object({
							bot: BotKindSchema,
						})
						.strict(),
					response: {
						200: ConfigSchema,
					},
				},
				handler: async (request, reply) => {
					const { bot } = request.params;
					const data = { ...this.data[bot], bot };

					await reply.send(data);
				},
			});
	}
}
