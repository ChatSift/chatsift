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

	// Route handlers throw Boom messages in lowercase sentence-fragment style (e.g. "guild not found") to read
	// well inline in code; the frontend renders `message` verbatim to the user, so capitalize it here once
	// rather than requiring every throw site to remember to write user-facing prose.
	const { message } = error.output.payload;
	if (typeof message === 'string' && message.length > 0) {
		error.output.payload.message = message[0]!.toUpperCase() + message.slice(1);
	}

	return res.end(JSON.stringify(error.output.payload));
}
