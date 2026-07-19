import { GRANTS } from '@chatsift/backend-core';
import type { GrantString } from '@chatsift/backend-core';
import type { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import type { Me } from '../../util/me.js';
import { fetchMe, fetchMeFromGrant } from '../../util/me.js';
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
		// Unlike getGuild/createAMA, this route doesn't care which capability the grant is for -- any valid
		// grant just needs a stripped identity back for its own guild. List every known grant string here
		// (rather than hardcoding one) so a future second grant type doesn't need this route touched too.
		grants: Object.values(GRANTS) as GrantString[],
	}),
	async handler(req): Promise<Me> {
		if (req.grant) {
			return fetchMeFromGrant(req.grant, req.logger);
		}

		return fetchMe(req.tokens!.access.discordAccessToken, req.logger, req.query.force_fresh);
	},
});
