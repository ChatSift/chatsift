/* eslint-disable n/callback-return */

import { createHash, timingSafeEqual } from 'node:crypto';
import { getContext } from '@chatsift/backend-core';
import { unauthorized } from '@hapi/boom';
import { defineMiddleware } from '../core/route.js';
import type { TypedMiddleware } from '../core/route.js';

const BEARER_PREFIX = 'Bearer ';

/**
 * Guards `/metrics` with a static shared secret sent via a standard `Authorization: Bearer <token>`
 * header, rather than a custom header like `requireWebhookSecret`'s `x-webhook-secret` -- Prometheus's
 * `scrape_config` has long-standing native support for `authorization.credentials_file` (re-read from
 * disk on every scrape, no Prometheus restart needed to rotate the secret), whereas an arbitrary
 * custom header name is a much newer/less-guaranteed feature on the Prometheus side. Same
 * hash-then-`timingSafeEqual` approach as `requireWebhookSecret` to avoid leaking the secret's length
 * through a mismatched-buffer-length short circuit.
 */
export function requireMetricsSecret(): TypedMiddleware {
	return defineMiddleware(async (req, _res, next) => {
		const header = req.headers.authorization;
		const provided =
			typeof header === 'string' && header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : undefined;
		const expected = getContext().env.METRICS_SECRET;

		const providedDigest = createHash('sha256')
			.update(typeof provided === 'string' ? provided : '')
			.digest();
		const expectedDigest = createHash('sha256').update(expected).digest();

		if (typeof provided !== 'string' || !timingSafeEqual(providedDigest, expectedDigest)) {
			return next(unauthorized('invalid metrics secret'));
		}

		await next();
	});
}
