import { getContext } from '@chatsift/backend-core';
import { nanoid } from 'nanoid';
import type { NextHandler, Request, Response } from 'polka';

/**
 * Attaches a per-request child logger (bound to a `requestId`) to `req.logger`. Mounted as the very first
 * `.use()` middleware in `app.ts`, ahead of cors/helmet/etc, so it covers as much of the request lifecycle as
 * polka allows -- including unmatched routes (`onNoMatch`) and errors thrown by other `.use()` middleware.
 *
 * It can still be missing in `onError` if something throws before this middleware runs at all (e.g. polka's own
 * routing/parsing) -- that's the one gap `app.ts`'s `onError` falls back to `getContext().logger` for.
 */
export function attachLogger() {
	return async (req: Request, _res: Response, next: NextHandler) => {
		req.logger = getContext().logger.child({ requestId: nanoid(10) });
		return next();
	};
}
