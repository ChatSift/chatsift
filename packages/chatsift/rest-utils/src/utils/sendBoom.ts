import type { Boom } from '@hapi/boom';
import type { Response } from 'polka';

/**
 * Send a Boom error to the client
 * @param error @hapi/boom `Boom` instance
 * @param res Response to send the error to
 */
export function sendBoom(error: Boom, res: Response) {
	res.statusCode = error.output.statusCode;
	for (const [header, value] of Object.entries(error.output.headers)) {
		res.setHeader(header, value!);
	}

	return res.end(JSON.stringify(error.output.payload));
}
