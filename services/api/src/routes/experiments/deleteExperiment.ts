import { getContext } from '@chatsift/backend-core';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';

const paramsSchema = z.object({ name: z.string().max(64) });

/**
 * Deleting an experiment is not the same as switching a feature off: gated code treats a missing experiment as
 * off (see `@chatsift/backend-core`'s `isExperimentEnabled`), so this is how a *retired* gate is cleaned up.
 * To pause a live one, collapse its range instead -- that keeps the row, and with it the record of who was
 * overridden into it. `experiment_overrides` cascades from here.
 */
export default defineRoute({
	method: 'delete',
	path: '/v3/experiments/:name',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: true,
	}),
	async handler(req): Promise<void> {
		const deleted = await getContext().db`DELETE FROM experiments WHERE name = ${req.params.name} RETURNING name`;

		if (deleted.length === 0) {
			throw notFound('no such experiment');
		}
	},
});
