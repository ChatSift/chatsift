import { getContext } from '@chatsift/backend-core';
import type { AppealQuestions, AppealsSettings } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export interface GetAppealsConfigResult {
	/**
	 * The questionnaire, in display order. Seeded from `DEFAULT_APPEAL_QUESTIONS` when the guild first saves a
	 * config, so this is empty for exactly as long as `settings` is `null`. Read-only on the dashboard until
	 * P7 ships the editor.
	 */
	questions: AppealQuestions[];
	/**
	 * `null` when the guild has not finished setup. Deliberately *not* defaulted into a synthetic row the way
	 * `modmail/config/getConfig.ts` does: there, every column is nullable and "no row" and "a row of defaults"
	 * mean the same thing, whereas here the row's existence is the whole signal the dashboard's setup CTA keys
	 * off (`mod_channel_id` is NOT NULL, so there is no defaultable shape to hand back anyway).
	 */
	settings: AppealsSettings | null;
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/appeals/config',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<GetAppealsConfigResult> {
		const { guildId } = req.params;
		const db = getContext().db;

		const [settings, questions] = await Promise.all([
			db<AppealsSettings[]>`SELECT * FROM appeals_settings WHERE guild_id = ${guildId}`,
			db<AppealQuestions[]>`
				SELECT * FROM appeal_questions WHERE guild_id = ${guildId} ORDER BY position ASC, id ASC
			`,
		]);

		return { settings: settings[0] ?? null, questions };
	},
});
