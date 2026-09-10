import { defineRoute } from '../../../core/route.js';
import { isAppealsAuthed } from '../../../middleware/isAppealsAuthed.js';
import { discordAPIAppeals } from '../../../util/discordAPI.js';
import type { PublicUserInfo } from '../../../util/users.js';
import { resolveDiscordUser, toPublicUserInfo } from '../../../util/users.js';

export interface AppealsMeResponse extends PublicUserInfo {
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
		const user = await resolveDiscordUser(discordAPIAppeals, sub);

		return { id: sub, ...toPublicUserInfo(user) };
	},
});
