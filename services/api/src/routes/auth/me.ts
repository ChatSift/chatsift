import type { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import type { Me } from '../../util/me.js';
import { fetchMe } from '../../util/me.js';
import { queryWithFreshSchema } from '../../util/schemas.js';

export type { Me, MeGuild } from '../../util/me.js';

const querySchema = queryWithFreshSchema;
export type GetAuthMeQuery = z.input<typeof querySchema>;

export default defineRoute({
	method: 'get',
	path: '/v3/auth/me',
	schema: {
		query: querySchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: false,
	}),
	async handler(req): Promise<Me> {
		return fetchMe(req.tokens!.access.discordAccessToken, req.logger, req.query.force_fresh);
	},
});
