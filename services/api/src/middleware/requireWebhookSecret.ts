/* eslint-disable n/callback-return */

import { createHash, timingSafeEqual } from 'node:crypto';
import { getContext } from '@chatsift/backend-core';
import { unauthorized } from '@hapi/boom';
import { defineMiddleware } from '../core/route.js';
import type { TypedMiddleware } from '../core/route.js';

/**
 * Guards a route with a static shared secret sent via the `x-webhook-secret` header, for callers
 * (e.g. Dozzle's webhook destinations) that can only send static headers, not compute a real session
 * or signature. Hashing both sides to a fixed-length digest before `timingSafeEqual` avoids leaking
 * the secret's length through a mismatched-buffer-length short circuit.
 */
export function requireWebhookSecret(): TypedMiddleware {
	return defineMiddleware(async (req, _res, next) => {
		const provided = req.headers['x-webhook-secret'];
		const expected = getContext().env.DOZZLE_WEBHOOK_SECRET;

		const providedDigest = createHash('sha256')
			.update(typeof provided === 'string' ? provided : '')
			.digest();
		const expectedDigest = createHash('sha256').update(expected).digest();

		if (typeof provided !== 'string' || !timingSafeEqual(providedDigest, expectedDigest)) {
			return next(unauthorized('invalid webhook secret'));
		}

		await next();
	});
}
