import type { Boom } from '@hapi/boom';
import type { Response } from 'polka';
import { treeifyError, ZodError } from 'zod';

/**
 * Send a Boom error to the client
 *
 * @param error - \@hapi/boom `Boom` instance
 * @param res - Response to send the error to
 */
export function sendBoom(error: Boom, res: Response) {
	res.statusCode = error.output.statusCode;
	for (const [header, value] of Object.entries(error.output.headers)) {
		res.setHeader(header, value!);
	}

	if (error.data instanceof ZodError) {
		error.output.payload = {
			...error.output.payload,
			...treeifyError(error.data),
		};
	}

	return res.end(JSON.stringify(error.output.payload));
}
