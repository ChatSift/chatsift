import { getContext } from '@chatsift/backend-core';
import type { AppealQuestions, AppealsSettings } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export interface AppealsConfigSettings extends Omit<AppealsSettings, 'createdAt' | 'modChannelId'> {
	/**
	 * `null` until a channel has been picked, which is also the only state in which no `appeals_settings` row
	 * exists at all -- the column is `NOT NULL`, so a row cannot be written without one.
	 *
	 * Note what that does *not* mean: this is the dashboard's view of the config, not the appellant-facing
	 * "does this guild accept appeals" answer. That one still keys off the row existing, and is asked
	 * server-side by `evaluateAppealEligibility`. Do not re-derive it from this field on the frontend.
	 */
	modChannelId: string | null;
}

export interface GetAppealsConfigResult {
	/**
	 * The questionnaire, in display order. Seeded from `DEFAULT_APPEAL_QUESTIONS` on the guild's first save, so
	 * this is empty for exactly as long as `modChannelId` is `null`. Read-only on the dashboard until P7 ships
	 * the editor.
	 */
	questions: AppealQuestions[];
	settings: AppealsConfigSettings;
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

		// No row yet is the common case, and it is answered with the shape a fresh row would have rather than a
		// `null` the dashboard has to branch on -- same as `modmail/config/getConfig.ts`, so the Appeals config
		// screen is an ordinary config form like every other bot's rather than a setup flow of its own.
		//
		// The numbers mirror the column defaults in `appeals_settings` (schema.sql), so what the form shows
		// before a first save is what that save would actually write. `createdAt` is deliberately not part of
		// this type: there is no honest value for it before the row exists, and nothing renders it.
		const resolved: AppealsConfigSettings = settings[0] ?? {
			guildId: guildId as AppealsSettings['guildId'],
			modChannelId: null,
			cooldownDays: 30,
			maxAppeals: null,
			autoRejoin: false,
			allowTimeoutAppeals: false,
		};

		return { settings: resolved, questions };
	},
});
