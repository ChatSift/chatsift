import { readAppealUserState, readRejoinCredential } from '@chatsift/backend-core';
import { defineRoute } from '../../../core/route.js';
import { isAppealsAuthed } from '../../../middleware/isAppealsAuthed.js';
import { discordAPIAppeals } from '../../../util/discordAPI.js';
import type { PublicUserInfo } from '../../../util/users.js';
import { resolveDiscordUser, toPublicUserInfo } from '../../../util/users.js';

export interface AppealsMeResponse extends PublicUserInfo {
	/**
	 * Whether an approval could actually put them back in a server if they asked it to (#232 P6). This is the
	 * capability and not the consent -- the consent is per appeal, and lives on the form.
	 *
	 * Derived rather than served raw, because `granted_guilds_join` alone is not the question. The stored
	 * credential is dropped once no appeal of theirs can still spend it, so the flag outlives the token by
	 * design -- and a form that read the flag would offer a re-add nothing could perform. Signing in again
	 * restores both, which is what the form tells them to do.
	 */
	canRejoin: boolean;
	/**
	 * `false` only when we know delivery will not work -- today, an authorization that declined the user
	 * install, or a DM Discord has actually refused. `null` is "never established", which every first-time
	 * appellant is and which the site says nothing about.
	 */
	dmReachable: boolean | null;
	id: string;
}

export default defineRoute({
	method: 'get',
	path: '/v3/appeals/auth/me',
	middleware: isAppealsAuthed({ fallthrough: false }),
	async handler(req): Promise<AppealsMeResponse> {
		const { sub } = req.appellant;

		// Resolved through the Appeals *bot* token and the shared cross-bot user cache, not the appellant's own
		// OAuth token -- which this session does not hold at all (see `util/appealsTokens.ts`). `GET /users/{id}`
		// answers with everything `unban.app` renders, and going through `resolveDiscordUser` means an appellant
		// reloading their status page costs Discord nothing.
		const [user, state] = await Promise.all([resolveDiscordUser(discordAPIAppeals, sub), readAppealUserState(sub)]);

		return {
			id: sub,
			...toPublicUserInfo(user),
			// Two derived bits and nothing else off that row. The refresh token never leaves the API under any
			// circumstances, and neither does when any of this was written -- `unban.app` needs to know what it can
			// offer them, not what we hold.
			canRejoin: readRejoinCredential(state) !== null,
			dmReachable: state?.dmReachable ?? null,
		};
	},
});
