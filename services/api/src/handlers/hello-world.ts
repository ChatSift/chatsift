import { injectable } from 'inversify';
import type { FastifyServer, Registerable } from '../server.js';

@injectable()
export default class HelloWorldHandler implements Registerable {
	public register(server: FastifyServer) {
		server.route({
			method: 'GET',
			url: '/hello-world',
			handler: async (request, reply) => {
				await reply.code(200).send({ hello: 'world' });
			},
		});
	}
}
