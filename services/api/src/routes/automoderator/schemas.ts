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
	})
	.refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');

/**
 * Bucket space `experiments.range_start`/`range_end` are expressed in -- kept in step with
 * `@chatsift/backend-core`'s `BUCKET_COUNT` by hand, since this file has to stay browser-safe and that one
 * pulls in `node:crypto`. `[0, 10000]` is everyone; a collapsed range is nobody.
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
