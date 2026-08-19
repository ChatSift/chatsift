// The preset caps live in `@chatsift/core` because three packages have to agree on them -- see their doc
// comment there. Imported rather than re-exported: callers take them from core directly, so there is exactly
// one import path for them.
import {
	AUTO_PARDON_MAX_DAYS,
	MAX_TIMEOUT_SECONDS,
	REPORT_PRESET_MAX_LENGTH,
	WARN_PUNISHMENT_MAX_WARNS,
} from '@chatsift/core';
import { z } from 'zod';
import { embedColorSchema, httpUrlSchema, snowflakeSchema } from '../../util/schemas.js';

/**
 * Browser-safe: only `zod` and `@chatsift/core` (which `apps/website` already imports directly), nothing
 * server-only. Exposed to `apps/website` via the
 * `@chatsift/api/automoderator-schemas` package export (see `package.json`), mirroring `ama/schemas.ts`,
 * `modmail/schemas.ts` and `social/schemas.ts`, so the dashboard validates against the exact rules the API
 * enforces.
 */
export const updateAutomoderatorConfigBodySchema = z
	.strictObject({
		// Ignored outside development -- see schema.sql and `automoderator-bot`'s `dryRun.ts`. Still writable
		// in production so the value doesn't silently diverge between a dev database and a production one.
		dryRun: z.boolean().optional(),
		// Nullable rather than just optional: clearing the channel is how a guild turns reporting off, and
		// absent-means-unchanged has no way to express that (see `updateConfig.ts`'s `'key' in body` handling).
		reportsChannelId: snowflakeSchema.nullable().optional(),
		// Days, and null is off -- the same nullable-means-off shape as the channel above.
		autoPardonWarnsAfter: z.number().int().min(1).max(AUTO_PARDON_MAX_DAYS).nullable().optional(),
	})
	.refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');

/**
 * Mirrors `CREATE TYPE automoderator_warn_punishment_action`. Spelled out for the same reason
 * `caseActionSchema` is.
 */
export const warnPunishmentActionSchema = z.enum(['MUTE', 'KICK', 'BAN']);

/**
 * A rung of the warn ladder. `warns` is the path parameter rather than a body field -- it is the row's identity,
 * and a PUT keyed on it is what makes "set the 3-warn rung" one idempotent call instead of a create/update pair
 * the dashboard would have to choose between.
 *
 * The three duration rules mirror `automoderator_warn_punishments_duration_check`, deliberately: the CHECK is
 * the one that cannot be bypassed, and this is the one that produces a message a human can act on.
 */
export const warnPunishmentBodySchema = z
	.strictObject({
		actionType: warnPunishmentActionSchema,
		durationSeconds: z.number().int().min(1).nullable().optional(),
		/**
		 * The warn count this step is being *moved from*, when the editor renumbers an existing one. Makes the
		 * move a single atomic write rather than a PUT followed by a DELETE, which had two problems: a failure
		 * between the halves left the guild with a duplicate step, and a guild sitting on the maximum number of
		 * steps could not renumber at all, because the insert saw a full ladder and the delete had not happened
		 * yet.
		 */
		replaces: z.number().int().min(1).max(WARN_PUNISHMENT_MAX_WARNS).optional(),
	})
	.superRefine((data, ctx) => {
		const duration = data.durationSeconds ?? null;

		if (data.actionType === 'KICK' && duration !== null) {
			ctx.addIssue({ code: 'custom', path: ['durationSeconds'], message: 'a kick has no duration' });
		}

		if (data.actionType === 'MUTE') {
			if (duration === null) {
				ctx.addIssue({ code: 'custom', path: ['durationSeconds'], message: 'a mute needs a duration' });
			} else if (duration > MAX_TIMEOUT_SECONDS) {
				ctx.addIssue({
					code: 'custom',
					path: ['durationSeconds'],
					message: 'Discord timeouts cap out at 28 days',
				});
			}
		}
	});

/**
 * Mirrors `CREATE TYPE automoderator_case_action`. Spelled out as a zod enum rather than imported from
 * `constants.ts` because this file has to stay browser-safe and that one imports `@chatsift/db` types --
 * which is erased at build time, but the dashboard's case filter needs these as runtime values anyway.
 */
export const caseActionSchema = z.enum(['WARN', 'MUTE', 'UNMUTE', 'KICK', 'SOFTBAN', 'BAN', 'UNBAN']);

/**
 * What a case can be changed to after the fact. Everything absent from here is a fact about a moment that
 * already happened -- rewriting a case's action or target would make its log embed a lie about what was done.
 *
 * `pardoned` is a boolean rather than a moderator id: who pardoned it is the caller, taken from the session,
 * never something the client gets to assert.
 */
export const updateCaseBodySchema = z
	.strictObject({
		reason: z.string().trim().max(400).nullable().optional(),
		refId: z.number().int().positive().nullable().optional(),
		pardoned: z.boolean().optional(),
	})
	.refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');

/**
 * The subset of `automoderator_log_type` a guild may point at a channel today. FILTER is deliberately absent:
 * nothing dispatches into it until P5, and a picker for a log nothing ever posts to is a setting that quietly
 * does nothing. MOD landed at P1, MESSAGE and USER at P4.
 *
 * Here rather than in `constants.ts` (which holds the *full* enum mirrors) because this file is the browser-safe
 * one -- the dashboard renders one picker per entry, so the list and the routes' path parameter come from the
 * same place instead of a hand-copied union drifting out of step with what the API accepts.
 */
export const WRITABLE_LOG_TYPES = ['MOD', 'MESSAGE', 'USER'] as const;

export const writableLogTypeSchema = z.enum(WRITABLE_LOG_TYPES);

export type WritableLogType = z.infer<typeof writableLogTypeSchema>;

/**
 * Configuring a log channel. The API creates the Discord webhook itself -- a channel id is all the dashboard
 * can meaningfully supply, and the token it produces must never reach a browser.
 */
export const setLogChannelBodySchema = z.strictObject({
	channelId: snowflakeSchema,
});

/**
 * Mirrors `CREATE TYPE automoderator_report_state`. Spelled out for the same reason `caseActionSchema` is.
 */
export const reportStateSchema = z.enum(['OPEN', 'DISMISSED', 'ACTIONED']);

export const reportPresetBodySchema = z.strictObject({
	reason: z.string().trim().min(1).max(REPORT_PRESET_MAX_LENGTH),
});

/**
 * Bucket space `experiments.range_start`/`range_end` are expressed in -- kept in step with
 * `@chatsift/backend-core`'s `BUCKET_COUNT` by hand, since this file has to stay browser-safe and that module
 * reaches `process.env` through its context. `[0, 10000]` is everyone; a collapsed range is nobody.
 */
export const EXPERIMENT_BUCKET_COUNT = 10_000;

export const upsertExperimentBodySchema = z
	.strictObject({
		rangeStart: z.number().int().min(0).max(EXPERIMENT_BUCKET_COUNT),
		rangeEnd: z.number().int().min(0).max(EXPERIMENT_BUCKET_COUNT),
		/**
		 * The full override set for this experiment, not a delta -- the route replaces whatever was there.
		 * An operator's mental model of a gate is "these guilds, plus this much of everyone else", and a
		 * declarative write is the only shape that can't drift from it after a few partial edits.
		 */
		overrides: z.array(snowflakeSchema).max(500),
	})
	.refine((data) => data.rangeStart <= data.rangeEnd, {
		message: 'rangeStart must be less than or equal to rangeEnd',
		path: ['rangeStart'],
	});

/**
 * The DM-reporting install prompt (P3b).
 *
 * Structured-or-raw, exactly like a ModMail panel and an AMA prompt: the structured form is what almost every
 * guild wants and is fully defaulted, and `prompt_raw` is the escape hatch for the handful who want to write
 * the message themselves. Every field on the structured object is optional because
 * `@chatsift/core`'s `REPORT_PROMPT_DEFAULT_*` fill the gaps -- a guild that names only a channel gets the
 * copy the feature was designed around.
 */
const reportPromptBase = z.strictObject({ channelId: snowflakeSchema });

export const createReportPromptWithRegularContentSchema = reportPromptBase.safeExtend({
	prompt: z.strictObject({
		title: z.string().min(1).max(255).optional(),
		description: z.string().min(1).max(4_000).optional(),
		buttonLabel: z.string().min(1).max(80).optional(),
		imageUrl: httpUrlSchema.optional(),
		thumbnailUrl: httpUrlSchema.optional(),
		// Omitted means the default color, not "leave whatever was there" -- the edit form always resends the
		// full `prompt` object, same as the panel and AMA forms it mirrors.
		color: embedColorSchema.optional(),
	}),
});

export const createReportPromptWithRawContentSchema = reportPromptBase.safeExtend({
	prompt_raw: z.strictObject({
		content: z.string().optional(),
		embeds: z.array(z.any()).optional(),
	}),
});

export const createReportPromptBodySchema = z.union([
	createReportPromptWithRegularContentSchema,
	createReportPromptWithRawContentSchema,
]);

/**
 * The channel is deliberately absent: moving a prompt means deleting it and posting a new one, because Discord
 * cannot move a message between channels and silently posting a second one would leave the first live.
 */
export const updateReportPromptBodySchema = z
	.strictObject({
		prompt: createReportPromptWithRegularContentSchema.shape.prompt.optional(),
		prompt_raw: createReportPromptWithRawContentSchema.shape.prompt_raw.optional(),
	})
	.refine((data) => Object.keys(data).length > 0, 'At least one field must be provided')
	.refine((data) => !('prompt' in data && 'prompt_raw' in data), 'Cannot provide both prompt and prompt_raw');
