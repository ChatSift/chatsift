import { Env } from '@automoderator/core';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { injectable } from 'inversify';
import type { FastifyServer, Registerable } from '../server.js';

@injectable()
export default class SetupHandler implements Registerable {
	public constructor(private readonly env: Env) {}

	public async register(server: FastifyServer) {
		await server.register(cors, { credentials: true, origin: this.env.cors ?? '*' });
		await server.register(helmet, {
			contentSecurityPolicy: this.env.nodeEnv === 'prod' ? undefined : false,
			referrerPolicy: false,
		});

		server.decorateRequest('discordUser', null);

		server.setValidatorCompiler(validatorCompiler);
		server.setSerializerCompiler(serializerCompiler);
	}
}
