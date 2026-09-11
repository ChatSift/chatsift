import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorLegacyBanwords } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

/**
 * One entry from the guild's legacy banned-word list, as it stood the moment AutoModerator moved off the old
 * stack. Read-only and frozen -- nothing writes this table after the migration.
 */
export interface LegacyBanword {
	/**
	 * Seconds, or null. Only ever meant anything for the `mute` and `ban` flags.
	 */
	readonly durationSeconds: number | null;
	/**
	 * The legacy `BanwordFlags` members this word carried: `word`, `warn`, `mute`, `ban`, `report`, `name`,
	 * `kick`. Rendered as-is rather than translated into the new vocabulary, because two of them (`word` and
	 * `name`) are not punishments at all and `name` has no modern equivalent to translate into.
	 */
	readonly flags: string[];
	readonly word: string;
}

export type ListLegacyBanwordsResult = LegacyBanword[];

/**
 * The guild's legacy banned-word list (#11 P9).
 *
 * Banned words did not migrate -- their matching half can only live in a native AutoMod rule and this port
 * never writes to Discord's AutoMod -- so every community rebuilds its keyword lists in Server Settings. This
 * is what makes that a reasonable thing to have asked: after `postgres-old` was torn down, this table is the
 * only remaining copy of what the list used to be.
 *
 * Deliberately temporary. See `LEGACY_BANWORD_ARCHIVE_UNTIL`; this route and the table behind it go together
 * when the archive is dropped.
 */
export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/automoderator/legacy-banwords',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<ListLegacyBanwordsResult> {
		const rows = await getContext().db<Pick<AutomoderatorLegacyBanwords, 'durationSeconds' | 'flags' | 'word'>[]>`
			SELECT word, flags, duration_seconds
			FROM automoderator_legacy_banwords
			WHERE guild_id = ${req.params.guildId}
			ORDER BY word ASC
		`;

		// `.toString()` because kanel brands primary-key columns.
		return rows.map((row) => ({
			word: row.word.toString(),
			flags: row.flags,
			durationSeconds: row.durationSeconds,
		}));
	},
});
