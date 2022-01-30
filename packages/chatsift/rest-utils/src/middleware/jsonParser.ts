import { badData, badRequest } from '@hapi/boom';
import type { NextHandler, Request, Response } from 'polka';

declare module 'polka' {
	interface Request {
		/**
		 * Raw (unparsed) JSON body of the request - present if `wantRaw` is set to `false` in {@link jsonParser}
		 */
		rawBody?: string;
	}
}

/**
 * Creates a request handler that parses the request body as JSON
 * @param wantRaw Whether to set the value of {@link Request.rawBody}
 */
export function jsonParser(wantRaw = false) {
	return async (req: Request, _: Response, next: NextHandler) => {
		if (!req.headers['content-type']?.startsWith('application/json')) {
			return next(badRequest('unexpected content type'));
		}

		req.setEncoding('utf8');

		try {
			let data = '';
			for await (const chunk of req) {
				data += chunk;
			}

			if (wantRaw) {
				req.rawBody = data;
			}

			if (data === '') {
				return await next();
			}

			req.body = JSON.parse(data) as unknown;

			await next();
		} catch (e) {
			const error = e as Error;
			return next(badData(error.message));
		}
	};
}
