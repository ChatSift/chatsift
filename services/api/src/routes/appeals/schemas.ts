import {
	APPEAL_ANSWER_MAX_LENGTH,
	APPEAL_COOLDOWN_MAX_DAYS,
	APPEAL_MAX_APPEALS_CEILING,
	APPEAL_QUESTION_MAX_COUNT,
} from '@chatsift/core';
import { z } from 'zod';
import { snowflakeSchema } from '../../util/schemas.js';

/**
 * Browser-safe: only `zod` and `@chatsift/core` (which `apps/website` already imports directly), nothing
 * server-only. Exposed to `apps/website` via the `@chatsift/api/appeals-schemas` package export (see
 * `package.json`), mirroring `ama/schemas.ts`, `modmail/schemas.ts`, `social/schemas.ts` and
 * `automoderator/schemas.ts`, so the dashboard validates against the exact rules the API enforces.
 */
export const updateAppealsConfigBodySchema = z.strictObject({
	// Not nullable, unlike most config channels here: `appeals_settings.mod_channel_id` is NOT NULL because the
	// row's existence is what tells the dashboard setup is finished (a guild that only *has the bot* is a
	// different state, and the setup CTA has to render for exactly one of them). Turning Appeals off is deleting
	// the row, not blanking the channel.
	modChannelId: snowflakeSchema.optional(),
	cooldownDays: z.number().int().min(0).max(APPEAL_COOLDOWN_MAX_DAYS).optional(),
	// Nullable-means-off: NULL is "no ceiling", which is the default and cannot be expressed by omission,
	// since absent means unchanged.
	maxAppeals: z.number().int().min(1).max(APPEAL_MAX_APPEALS_CEILING).nullable().optional(),
	autoRejoin: z.boolean().optional(),
	allowTimeoutAppeals: z.boolean().optional(),
});

export const createUnappealableUserBodySchema = z.strictObject({
	userId: snowflakeSchema,
	// Moderator-facing only -- the appellant is told they cannot appeal, never why. Sized against an embed
	// field value, which is where this ends up on the mod side.
	reason: z.string().trim().min(1).max(1_024).nullable().optional(),
});

export const deleteUnappealableUserBodySchema = z.strictObject({
	userId: snowflakeSchema,
});

/**
 * An appeal as `unban.app` submits it (P3). Answers are addressed by question id rather than by position: a
 * guild editing its questionnaire (P7) between the form rendering and the appellant pressing submit would
 * otherwise silently re-point every answer at whatever question now sits at that index, and the
 * `prompt_snapshot` written alongside would record the wrong prompt for the rest of the appeal's life.
 *
 * Empty answers are accepted here and rejected in the route instead, where the guild's `required` flags are
 * known -- an optional question left blank is a legitimate submission, and zod cannot tell the two apart.
 */
export const submitAppealBodySchema = z.strictObject({
	answers: z
		.array(
			z.strictObject({
				questionId: z.number().int().positive(),
				answer: z.string().trim().max(APPEAL_ANSWER_MAX_LENGTH),
			}),
		)
		.max(APPEAL_QUESTION_MAX_COUNT),
});
