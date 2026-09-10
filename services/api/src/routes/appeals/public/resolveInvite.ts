import { getContext } from '@chatsift/backend-core';
import type { AppealsSettings } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAppealsAuthed } from '../../../middleware/isAppealsAuthed.js';
import { discordAPIAppeals } from '../../../util/discordAPI.js';
import { isNotFoundDiscordError } from '../../../util/discordErrors.js';

/**
 * Discord's own invite-code alphabet, plus a length ceiling. Vanity codes are ordinary words, so this is
 * deliberately permissive about content and strict about shape -- its job is to keep obvious junk (a pasted
 * sentence, a path traversal) from reaching Discord's rate limit at all, not to predict what a valid code
 * looks like.
 */
const paramsSchema = z.object({ code: z.string().regex(/^[\w-]{1,64}$/) });

export interface ResolveInviteResult {
	guildId: string;
}

export default defineRoute({
	method: 'get',
	path: '/v3/appeals/invites/:code',
	schema: {
		params: paramsSchema,
	},
	middleware: isAppealsAuthed({ fallthrough: false }),
	async handler(req): Promise<ResolveInviteResult> {
		const { code } = req.params;

		// The entry point that makes the product usable for somebody who arrived with nothing but a link from
		// their scrollback: swap `discord.gg` for `unban.app` in an invite they already have (decision 12). One
		// Discord call, no search index, no directory.
		let invite;
		try {
			invite = await discordAPIAppeals.invites.get(code);
		} catch (error) {
			if (isNotFoundDiscordError(error)) {
				throw notFound('that invite is expired or does not exist');
			}

			throw error;
		}

		const guildId = invite.guild?.id;
		if (!guildId) {
			// A group-DM invite. Real, resolvable, and nothing to do with a guild.
			throw notFound('that invite is expired or does not exist');
		}

		const [settings] = await getContext().db<Pick<AppealsSettings, 'guildId'>[]>`
			SELECT guild_id FROM appeals_settings WHERE guild_id = ${guildId}
		`;

		// Answered here rather than left to `checkGuild` so this route never becomes a way to ask "does this
		// invite resolve" about a guild that has nothing to do with us -- the only guild ids it will hand back
		// are ones already reachable by their own deep link.
		if (!settings) {
			throw notFound('that server does not accept appeals here');
		}

		return { guildId };
	},
});
