import { z } from 'zod';
import { snowflakeSchema } from '../../util/schemas.js';

/**
 * Browser-safe: only `zod`, nothing server-only. Exposed to `apps/website` via the
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
	})
	.refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');

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

/**
 * A canned report reason. The 100 cap is Discord's, not ours: a preset is rendered as a select-menu option
 * label, and Discord truncates those at 100 characters -- accepting more would store text a reporter can never
 * read in full.
 */
export const REPORT_PRESET_MAX_LENGTH = 100;

/**
 * Discord's select menus hold 25 options, so a 26th preset would be one the reason picker silently never
 * offers. Enforced on create rather than at render time, where it would be invisible.
 */
export const REPORT_PRESET_MAX_COUNT = 25;

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
