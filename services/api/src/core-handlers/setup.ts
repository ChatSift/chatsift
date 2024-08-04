import { Env } from '@chatsift/service-core';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { injectable } from 'inversify';
import type { FastifyServer, Registerable } from '../server.js';

@injectable()
export default class SetupHandler implements Registerable {
	public async register(server: FastifyServer) {
		await server.register(cors, { credentials: true, origin: Env.CORS ?? '*' });
		await server.register(helmet, {
			contentSecurityPolicy: Env.NODE_ENV === 'prod' ? undefined : false,
			referrerPolicy: false,
		});

		server.decorateRequest('discordUser', null);

		server.setValidatorCompiler(validatorCompiler);
		server.setSerializerCompiler(serializerCompiler);
	}
}
