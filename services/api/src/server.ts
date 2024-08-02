import { Env, INJECTION_TOKENS } from '@automoderator/core';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { badRequest, Boom, isBoom } from '@hapi/boom';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { inject, injectable } from 'inversify';
import type { Logger } from 'pino';
import { ZodError } from 'zod';

export type FastifyServer = Server['fastify'];

export interface Registerable {
	register(fastify: FastifyServer): void;
}

export type RegisterableConstructor = new (...args: any[]) => Registerable;

@injectable()
export class Server {
	public constructor(
		@inject(INJECTION_TOKENS.logger) private readonly logger: Logger,
		private readonly env: Env,
	) {}

	private readonly fastify = Fastify({ logger: this.logger });

	public register(registerable: Registerable): void {
		registerable.register(this.fastify);
	}

	public async listen(): Promise<void> {
		await this.fastify.register(cors, { credentials: true, origin: this.env.cors ?? '*' });
		await this.fastify.register(helmet, {
			contentSecurityPolicy: this.env.nodeEnv === 'prod' ? undefined : false,
			referrerPolicy: false,
		});

		this.fastify.decorateRequest('discordUser', null);

		this.fastify.setValidatorCompiler(validatorCompiler);
		this.fastify.setSerializerCompiler(serializerCompiler);
		// eslint-disable-next-line promise/prefer-await-to-callbacks
		this.fastify.setErrorHandler(async (error, _, reply) => {
			// Log appropriately depending on what was thrown
			if (reply.statusCode >= 400 && reply.statusCode < 500) {
				this.logger.info(error);
			} else {
				this.logger.error(error);
			}

			// Standardize errors
			let boom;
			if (isBoom(error)) {
				boom = error;
			} else if (error instanceof ZodError) {
				boom = badRequest('Invalid request payload', { details: error.errors });
			} else {
				boom = new Boom(error);
			}

			void reply.code(boom.output.statusCode);

			for (const [header, value] of Object.entries(boom.output.headers)) {
				void reply.header(header, value);
			}

			await reply.send({ ...boom.output.payload, ...boom.data });
		});

		const port = Number(new URL(this.env.apiURL).port);

		await this.fastify.ready();
		await this.fastify.listen({ port, host: '0.0.0.0' });
	}
}
