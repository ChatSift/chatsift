import { getContext, getInstanceForGuild } from '@chatsift/backend-core';
import type { ModmailInstanceInterest } from '@chatsift/db';
import { conflict } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { resolveUserBestEffort } from '../threads/util.js';
import type { GetModmailInstanceInterestResult } from './getInstanceInterest.js';

const bodySchema = z.strictObject({});
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type RegisterModmailInstanceInterestBody = z.input<typeof bodySchema>;
export type RegisterModmailInstanceInterestResult = GetModmailInstanceInterestResult;

/**
 * Registers this guild's interest in a custom ModMail instance (#216) -- a lead for the operator, not a
 * setting. There is no route to undo it anywhere, by design: the dashboard confirms before pressing, and a
 * withdrawal reaching nobody is worse than a lead that turns out to be stale.
 */
export default defineRoute({
	method: 'post',
	path: '/v3/guilds/:guildId/modmail/instance-interest',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<RegisterModmailInstanceInterestResult> {
		const { guildId } = req.params;

		// The dashboard already hides the card for a guild that has an instance; rejecting here as well keeps
		// the two from drifting into a lead list that contains existing partners.
		if (getInstanceForGuild(guildId)) {
			throw conflict('this server is already served by a custom instance');
		}

		const db = getContext().db;

		// `DO NOTHING` rather than an upsert: the row records who asked first and when, and a second manager
		// pressing the button later must rewrite neither. That leaves `RETURNING` empty on a conflict, hence
		// the read-back.
		const [inserted] = await db<ModmailInstanceInterest[]>`
			INSERT INTO modmail_instance_interest (guild_id, user_id, guild_name)
			VALUES (${guildId}, ${req.tokens.access.sub}, ${req.guild!.name})
			ON CONFLICT (guild_id) DO NOTHING
			RETURNING *
		`;

		const row =
			inserted ??
			(
				await db<ModmailInstanceInterest[]>`
					SELECT * FROM modmail_instance_interest WHERE guild_id = ${guildId}
				`
			)[0]!;

		return {
			interest: {
				createdAt: row.createdAt,
				user: await resolveUserBestEffort(guildId, row.userId, req.logger),
			},
		};
	},
});
