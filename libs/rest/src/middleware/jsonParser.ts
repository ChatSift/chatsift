import { badData, badRequest } from '@hapi/boom';
import type { NextHandler, Request, Response } from 'polka';

declare module 'polka' {
	interface Request {
		rawBody?: string;
	}
}

export const jsonParser =
	(wantRaw = false) =>
	async (req: Request, _: Response, next: NextHandler) => {
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

			return await next();
		} catch (e) {
			const error = e as Error;
			return next(badData(error.message));
		}
	};
