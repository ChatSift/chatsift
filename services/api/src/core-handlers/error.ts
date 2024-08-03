import { badRequest, Boom, isBoom } from '@hapi/boom';
import { injectable } from 'inversify';
import { ZodError } from 'zod';
import type { FastifyServer, Registerable } from '../server.js';

@injectable()
export default class ErrorHandler implements Registerable {
	public register(server: FastifyServer) {
		// eslint-disable-next-line promise/prefer-await-to-callbacks
		server.setErrorHandler(async (error, request, reply) => {
			// Log appropriately depending on what was thrown
			if (reply.statusCode >= 400 && reply.statusCode < 500) {
				request.log.info(error);
			} else {
				request.log.error(error);
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

			void reply.status(boom.output.statusCode);

			for (const [header, value] of Object.entries(boom.output.headers)) {
				void reply.header(header, value);
			}

			await reply.send({ ...boom.output.payload, ...boom.data });
		});
	}
}
