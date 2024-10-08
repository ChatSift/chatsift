import { Env, INJECTION_TOKENS } from '@chatsift/service-core';
import Fastify from 'fastify';
import { inject, injectable } from 'inversify';
import type { Logger } from 'pino';

export type FastifyServer = Server['fastify'];

export interface Registerable {
	register(fastify: FastifyServer): void;
}

export type RegisterableConstructor = new (...args: any[]) => Registerable;

@injectable()
export class Server {
	public constructor(@inject(INJECTION_TOKENS.logger) private readonly logger: Logger) {}

	private readonly fastify = Fastify({ logger: this.logger });

	public register(registerable: Registerable): void {
		registerable.register(this.fastify);
	}

	public async listen(): Promise<void> {
		const port = Number(Env.API_PORT);

		await this.fastify.ready();
		await this.fastify.listen({ port, host: '0.0.0.0' });
	}
}
