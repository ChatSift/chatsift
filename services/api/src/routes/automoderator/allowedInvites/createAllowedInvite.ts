import { getContext } from '@chatsift/backend-core';
import { ALLOWED_INVITE_MAX_COUNT, automoderatorAllowedInvitesChannel, extractInviteCodes } from '@chatsift/core';
import type { AutomoderatorAllowedInvites } from '@chatsift/db';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { badRequest } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { discordAPIAutomoderator } from '../../../util/discordAPI.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { allowedInviteBodySchema } from '../schemas.js';
import type { AllowedInvite } from './listAllowedInvites.js';

const bodySchema = allowedInviteBodySchema;
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type CreateAllowedInviteBody = z.input<typeof bodySchema>;
export type CreateAllowedInviteResult = AllowedInvite;

/**
 * A bare code, or one wrapped in any of the spellings `extractInviteCodes` knows. Run through the shared
 * extractor first so a pasted `https://discord.gg/abc` and a typed `abc` reach Discord as the same code -- and
 * so the API accepts exactly the forms the bot's runner recognises in a message.
 */
function resolveCode(input: string): string | null {
	const [fromLink] = extractInviteCodes(input);
	if (fromLink !== undefined) {
		return fromLink;
	}

	// Not a link, so the whole field has to be the code. Anything with whitespace or a slash in it is a
	// mistyped link rather than a code, and sending it to Discord would spend a request to be told so.
	return /^[\w-]{2,}$/.test(input) ? input : null;
}

/**
 * Adds a server to the invite filter's allowlist (P5b, feature 03).
 *
 * **Resolved at write time, and stored as the guild id.** A server has any number of invite codes and can mint
 * more at will, and its vanity URL is a third spelling of the same destination -- so keying on the code would
 * allow one link rather than one server, which is the bug legacy fixed in 2021. The cost, which the dashboard
 * states: an expired or revoked code cannot be allowlisted at all, because there is nothing to resolve it to.
 */
export default defineRoute({
	method: 'post',
	path: '/v3/guilds/:guildId/automoderator/allowed-invites',
	schema: { body: bodySchema, params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorAllowedInvitesChannel(req.params.guildId),
	async handler(req): Promise<CreateAllowedInviteResult> {
		const { guildId } = req.params;

		const code = resolveCode(req.body.invite);
		if (code === null) {
			throw badRequest('that is not an invite -- paste a link like discord.gg/example, or just the code');
		}

		let invite;
		try {
			invite = await discordAPIAutomoderator.invites.get(code);
		} catch (error) {
			// An unknown invite is the ordinary outcome for a typo or an expired link, and it is what the manager
			// needs told. Anything else is ours and is worth a 500 with the log line behind it.
			if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownInvite) {
				throw badRequest('that invite has expired or does not exist');
			}

			getContext().logger.error({ err: error, guildId }, 'failed to resolve an invite for the allowlist');
			throw error;
		}

		// A group-DM invite has no guild at all, and there is nothing for the filter to allow.
		if (!invite.guild) {
			throw badRequest('that invite is not to a server');
		}

		const allowedGuildId = invite.guild.id;
		const name = invite.guild.name;

		// Cap enforced inside the insert, the same shape as every other list route here. `DO UPDATE` also
		// refreshes the stored name, which makes re-adding an already-allowed server the way a manager updates a
		// name that has since changed -- the only refresh mechanism this snapshot can have.
		const [row] = await getContext().db<Pick<AutomoderatorAllowedInvites, 'allowedGuildId'>[]>`
			INSERT INTO automoderator_allowed_invites (guild_id, allowed_guild_id, name)
			SELECT ${guildId}, ${allowedGuildId}, ${name}
			WHERE (
				SELECT count(*) FROM automoderator_allowed_invites
				WHERE guild_id = ${guildId} AND allowed_guild_id <> ${allowedGuildId}
			) < ${ALLOWED_INVITE_MAX_COUNT}
			ON CONFLICT (guild_id, allowed_guild_id) DO UPDATE SET name = EXCLUDED.name
			RETURNING allowed_guild_id
		`;

		if (!row) {
			throw badRequest(`a server can allow invites to at most ${ALLOWED_INVITE_MAX_COUNT} servers`);
		}

		return { allowedGuildId, name };
	},
});
