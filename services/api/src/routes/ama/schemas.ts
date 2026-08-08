import type { AmaQuestionState } from '@chatsift/db';
import { z } from 'zod';
import { snowflakeSchema } from '../../util/schemas.js';

/**
 * Browser-safe: only `zod` + the pure `snowflakeSchema` regex, nothing server-only. Exposed to `apps/website` via
 * the `@chatsift/api/ama-schemas` package export (see `package.json`) so the dashboard validates against the exact
 * same rules the API enforces, without pulling the rest of this package (bcrypt, jsonwebtoken, discord.js REST,
 * route handlers, ...) into a client bundle.
 */

// Only PENDING_REVIEW is mergeable -- once a question is APPROVED it's already handed off for a guest
// to write and send an answer, so folding another question's askers into it at that point doesn't fit
// the workflow anymore. ASKED means it's already publicly posted (its answers-channel message gets
// deleted on merge), and DENIED is already a resolved outcome -- merging either away as "just a
// duplicate", or merging a new asker into one, would silently undo a decision or mutate already-public
// content. Shared between `services/api` (`mergeShared.ts`'s route-level validation) and `apps/website`
// (the dashboard's merge pickers/selection UI) via this browser-safe module so both can never drift out
// of sync.
export const MERGEABLE_STATES: ReadonlySet<AmaQuestionState> = new Set([
	'PENDING_REVIEW',
] as readonly AmaQuestionState[]);

const createAMABase = z.strictObject({
	queueId: snowflakeSchema.nullable(),
	title: z.string().min(1).max(255),
	answersChannelId: snowflakeSchema,
	promptChannelId: snowflakeSchema,
	allowedQuestionUploads: z.number().int().min(0).max(10).default(0),
	// Optional automated close date (#290) -- ama-bot's scheduledCloseSweep.ts flips `ended` once this
	// lapses, the same way `/ama close` does. `.nullable()` alone (not just `.optional()`) so an edit can
	// explicitly clear a previously-set date, mirroring modmail's `expiresAt`.
	scheduledCloseAt: z.iso
		.datetime()
		.refine((value) => new Date(value).getTime() > Date.now(), 'Scheduled close date must be in the future')
		.nullable()
		.optional(),
	// Dash-only review (#293 follow-up): splits "does review exist" from "does it have a Discord
	// channel" -- review can be enabled with no channel picked, meaning it's managed entirely from the
	// dashboard (by mods there and/or any configured `guestIds`). Mirrors the CHECK constraint in
	// schema.sql.
	reviewEnabled: z.boolean().optional().default(false),
	// Decouples approving a question from posting it (#293 follow-up) -- see schema.sql's comment on
	// `ama_sessions.prepared_answers_enabled`.
	preparedAnswersEnabled: z.boolean().optional().default(false),
	// Known guest user ids (#293 follow-up, scope widened for guest dashboard access) -- grants scoped
	// dashboard access to this AMA (approve/deny/merge/prepare+send answers/tag) regardless of general
	// guild-manage status, and backs the "answered by" picker in the dashboard's answer editor. Editable
	// retroactively via updateAMA. Capped well above any realistic guest list.
	guestIds: z.array(snowflakeSchema).max(50).optional().default([]),
});

export const createAMAWithRegularPromptSchema = createAMABase.safeExtend({
	prompt: z.strictObject({
		description: z.string().max(4_000).optional(),
		plainText: z.string().max(100).optional(),
		imageURL: z.url().optional(),
		thumbnailURL: z.url().optional(),
	}),
});

export const createAMAWithRawPromptSchema = createAMABase.safeExtend({
	prompt_raw: z.strictObject({
		content: z.string().optional(),
		embeds: z.array(z.any()).optional(),
	}),
});

export const createAMABodySchema = z
	.union([createAMAWithRegularPromptSchema, createAMAWithRawPromptSchema])
	.refine((data) => data.reviewEnabled || !data.queueId, {
		message: 'queueId can only be set when reviewEnabled is true',
		path: ['queueId'],
	});

// `ended` is the DB column, but what it actually gates is question *submission* (#299) -- everything else
// (triage, answering, config edits) keeps working on a closed session, and closing is reversible, hence a
// plain boolean rather than the one-way `z.literal(true)` this used to be.
export const updateAMAEndedSchema = z.strictObject({
	ended: z.boolean(),
});

export const updateAMAConfigSchema = z
	.strictObject({
		title: z.string().min(1).max(255).optional(),
		answersChannelId: snowflakeSchema.optional(),
		queueId: snowflakeSchema.nullable().optional(),
		allowedQuestionUploads: z.number().int().min(0).max(10).optional(),
		scheduledCloseAt: createAMABase.shape.scheduledCloseAt,
		reviewEnabled: z.boolean().optional(),
		preparedAnswersEnabled: z.boolean().optional(),
		guestIds: z.array(snowflakeSchema).max(50).optional(),
		prompt: createAMAWithRegularPromptSchema.shape.prompt.optional(),
		prompt_raw: createAMAWithRawPromptSchema.shape.prompt_raw.optional(),
	})
	.refine((data) => Object.keys(data).length > 0, 'At least one field must be provided')
	.refine((data) => !('prompt' in data && 'prompt_raw' in data), 'Cannot provide both prompt and prompt_raw');

export const updateAMABodySchema = z.union([updateAMAEndedSchema, updateAMAConfigSchema]);
