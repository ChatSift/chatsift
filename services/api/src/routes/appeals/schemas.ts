import {
	APPEAL_ANSWER_MAX_LENGTH,
	APPEAL_COOLDOWN_MAX_DAYS,
	APPEAL_DECISION_REASON_MAX_LENGTH,
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
	/**
	 * Decision 14's third side (#232 P6): the box on the appeal form saying they are willing to be put straight
	 * back into *this* server if it is approved.
	 *
	 * Defaulted to `false` rather than required, and the default is the safe direction -- a client that omits it
	 * gets an appellant who consented to nothing, which costs them an automatic re-add and nothing else. Asked
	 * per appeal rather than read off the OAuth grant because the grant is a capability given once to
	 * `unban.app`, not a standing instruction about every server somebody is banned from.
	 */
	rejoinConsent: z.boolean().default(false),
});

/**
 * The queue's status filter. Mirrors `appeal_status` exactly, in the order the queue lists it -- derived from
 * the schema on the dashboard side (as `reportStateSchema` is) so a filter value the route would reject cannot
 * be constructed there in the first place.
 *
 * Mod-facing, unlike everything in `appealsPublic.ts`: a silent denial is a `DENIED` row here and says so, and
 * that is the whole point of the second surface. `PENDING` here means genuinely pending.
 */
export const appealStatusSchema = z.enum(['PENDING', 'APPROVED', 'DENIED', 'WITHDRAWN', 'MOOT']);

/**
 * The dashboard's half of the three buttons (#232 P5).
 *
 * One discriminator rather than `status` + `silent`: those two can be combined into states the database then
 * refuses (`appeals_silent_check`), and there is no reason to let a client construct one. The values are the
 * bot's own `AppealButtonDecision` names, so the two surfaces label the same act the same way.
 */
export const decideAppealBodySchema = z
	.strictObject({
		decision: z.enum(['approve', 'deny', 'deny_silent']),
		reason: z.string().trim().max(APPEAL_DECISION_REASON_MAX_LENGTH).nullable().optional(),
	})
	// The same rule the bot's denial modal enforces with `required: !silent`. An ordinary denial's reason is the
	// entire message the appellant is given, and a denial with no reason is the thing every appeal system is
	// criticised for; a silent denial has no reader waiting on it, so blank there is a legitimate "no comment".
	.refine((data) => data.decision !== 'deny' || Boolean(data.reason?.length), {
		message: 'A denial the appellant can see has to say why',
		path: ['reason'],
	})
	// Refused rather than ignored. The card has no reason box on Approve at all, so accepting one here would put
	// text in front of an appellant (P6 DMs a non-silent decision's reason) that only one of the two surfaces can
	// ever produce -- which is the drift decision 1 exists to prevent.
	.refine((data) => data.decision !== 'approve' || !data.reason, {
		message: 'An approval carries no reason, matching the card in Discord',
		path: ['reason'],
	});
