import { getContext, GRANTS } from '@chatsift/backend-core';
import type { GuildSettings } from '@chatsift/db';
import type { APIUser, Snowflake } from '@discordjs/core';
import { ChannelType } from '@discordjs/core';
import { badRequest, internal } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { fetchGuildChannels } from '../../../util/channels.js';
import { releaseGrantOnError } from '../../../util/grant.js';
import { assertRolesBelongToGuild } from '../../../util/roles.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { updateConfigBodySchema } from '../schemas.js';
import { resolveUserBestEffort } from '../threads/util.js';

const bodySchema = updateConfigBodySchema;
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type UpdateModmailConfigBody = z.input<typeof bodySchema>;

export interface UpdateModmailConfigResult extends GuildSettings {
	// See `getConfig.ts`'s matching field for why this exists -- kept in sync here so the mutation
	// response (which the frontend writes straight into the same query cache, see `useUpdateModmailConfig`)
	// doesn't regress to a raw snowflake until the next GET refetch.
	recordThreadContentEnabledByUser: APIUser | Snowflake | null;
}

export default defineRoute({
	method: 'patch',
	path: '/v3/guilds/:guildId/modmail/config',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		claimsGrant: true,
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
		grants: [GRANTS.MODMAIL_CONFIG_UPDATE],
	}),
	async handler(req): Promise<UpdateModmailConfigResult> {
		const data = req.body;
		const { guildId } = req.params;
		const db = getContext().db;

		// Everything below can fail after the grant (if any) was already atomically claimed in `isAuthed` -- a
		// single outer try/catch covering channel/role validation through the upsert means a correctable mistake
		// (bad channel/role id) releases the claim instead of permanently burning the user's single-use link.
		try {
			if (data.modForumId) {
				const channels = await fetchGuildChannels(guildId, 'MODMAIL');
				if (!channels) {
					req.logger.warn({ guildId }, `Failed to fetch channels for guild ${guildId}`);
					throw internal();
				}

				const forumChannel = channels.find((channel) => channel.id === data.modForumId);
				if (!forumChannel) {
					throw badRequest(`channel ${data.modForumId} does not belong to this guild`);
				}

				if (forumChannel.type !== ChannelType.GuildForum) {
					throw badRequest('modForumId must point at a forum channel');
				}
			}

			if (data.alertRoleId) {
				await assertRolesBelongToGuild(guildId, [data.alertRoleId], 'MODMAIL', req.logger);
			}

			const columns = Object.keys(data) as (keyof typeof data)[];

			// `record_thread_content_enabled_by`/`_at` only get (re-)stamped on a false->true transition
			// of the toggle itself, and are otherwise left exactly as they were -- including across a
			// later disable, per the audit-trail decision in #261. Computed via a `CASE` comparing the
			// row's pre-update value (bare `guild_settings.record_thread_content`) against the proposed new
			// one (`EXCLUDED.record_thread_content`) so this works correctly in the same upsert regardless
			// of whether `recordThreadContent` was even part of this particular PATCH body.
			const recordThreadContentEnabledNow = data.recordThreadContent === true;
			const [settings] = await db<GuildSettings[]>`
				INSERT INTO guild_settings (
					guild_id, mod_forum_id, default_greeting_message, farewell_message, simple_mode, alert_role_id, anon_reply_label,
					max_concurrent_threads, nuke_delay_minutes, greeting_before_opener, record_thread_content,
					record_thread_content_enabled_by, record_thread_content_enabled_at
				)
				VALUES (
					${guildId}, ${data.modForumId ?? null}, ${data.defaultGreetingMessage ?? null},
					${data.farewellMessage ?? null}, ${data.simpleMode ?? false}, ${data.alertRoleId ?? null},
					${data.anonReplyLabel ?? null}, ${data.maxConcurrentThreads ?? 1}, ${data.nukeDelayMinutes ?? null},
					${data.greetingBeforeOpener ?? false}, ${data.recordThreadContent ?? false},
					${recordThreadContentEnabledNow ? req.tokens.access.sub : null},
					${recordThreadContentEnabledNow ? new Date() : null}
				)
				ON CONFLICT (guild_id) DO UPDATE SET
					${db(data, ...columns)},
					record_thread_content_enabled_by = CASE
						WHEN EXCLUDED.record_thread_content AND NOT guild_settings.record_thread_content
							THEN EXCLUDED.record_thread_content_enabled_by
						ELSE guild_settings.record_thread_content_enabled_by
					END,
					record_thread_content_enabled_at = CASE
						WHEN EXCLUDED.record_thread_content AND NOT guild_settings.record_thread_content
							THEN EXCLUDED.record_thread_content_enabled_at
						ELSE guild_settings.record_thread_content_enabled_at
					END
				RETURNING *
			`;

			return {
				...settings!,
				recordThreadContentEnabledByUser: settings!.recordThreadContentEnabledBy
					? await resolveUserBestEffort(settings!.recordThreadContentEnabledBy, req.logger)
					: null,
			};
		} catch (error) {
			await releaseGrantOnError(req.grant, req.logger);
			throw error;
		}
	},
});
