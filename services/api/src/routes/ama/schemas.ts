import { z } from 'zod';
import { snowflakeSchema } from '../../util/schemas.js';

/**
 * Browser-safe: only `zod` + the pure `snowflakeSchema` regex, nothing server-only. Exposed to `apps/website` via
 * the `@chatsift/api/ama-schemas` package export (see `package.json`) so the dashboard validates against the exact
 * same rules the API enforces, without pulling the rest of this package (bcrypt, jsonwebtoken, discord.js REST,
 * route handlers, ...) into a client bundle.
 */

const createAMABase = z.strictObject({
	modQueueId: snowflakeSchema.nullable(),
	flaggedQueueId: snowflakeSchema.nullable(),
	guestQueueId: snowflakeSchema.nullable(),
	title: z.string().min(1).max(255),
	answersChannelId: snowflakeSchema,
	promptChannelId: snowflakeSchema,
	allowedQuestionUploads: z.number().int().min(0).max(10).default(0),
	// Optional automated close date (#290) -- ama-bot's scheduledCloseSweep.ts flips `ended` once this
	// lapses, the same way `/ama end` does. `.nullable()` alone (not just `.optional()`) so an edit can
	// explicitly clear a previously-set date, mirroring modmail's `expiresAt`.
	scheduledCloseAt: z.iso
		.datetime()
		.refine((value) => new Date(value).getTime() > Date.now(), 'Scheduled close date must be in the future')
		.nullable()
		.optional(),
	// Dash-only mod review (#293 follow-up): splits "does this stage exist" from "does it have a Discord
	// channel" -- mod review can be enabled with no channel picked, meaning it's managed entirely from
	// the dashboard. Mirrors the CHECK constraint in schema.sql. Guest review has no dash-only mode --
	// guests generally don't have dashboard access, so its existence is just `guestQueueId` truthiness.
	modReviewEnabled: z.boolean().optional().default(false),
	// Decouples approving a question from posting it (#293 follow-up) -- see schema.sql's comment on
	// `ama_sessions.prepared_answers_enabled`.
	preparedAnswersEnabled: z.boolean().optional().default(false),
	// Known guest-answerer user ids (#293 follow-up) -- backs the "answered by" picker in both the guest
	// queue's Add Answer modal and the dashboard's answer editor. Editable retroactively via updateAMA.
	guestIds: z.array(snowflakeSchema).optional().default([]),
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
	.refine((data) => data.modReviewEnabled || !data.modQueueId, {
		message: 'modQueueId can only be set when modReviewEnabled is true',
		path: ['modQueueId'],
	})
	.refine((data) => data.modReviewEnabled || !data.flaggedQueueId, {
		message: 'flaggedQueueId can only be set when modReviewEnabled is true (flagging only happens from mod review)',
		path: ['flaggedQueueId'],
	});

export const updateAMAEndSchema = z.strictObject({
	ended: z.literal(true),
});

export const updateAMAConfigSchema = z
	.strictObject({
		title: z.string().min(1).max(255).optional(),
		answersChannelId: snowflakeSchema.optional(),
		modQueueId: snowflakeSchema.nullable().optional(),
		flaggedQueueId: snowflakeSchema.nullable().optional(),
		guestQueueId: snowflakeSchema.nullable().optional(),
		allowedQuestionUploads: z.number().int().min(0).max(10).optional(),
		scheduledCloseAt: createAMABase.shape.scheduledCloseAt,
		modReviewEnabled: z.boolean().optional(),
		preparedAnswersEnabled: z.boolean().optional(),
		guestIds: z.array(snowflakeSchema).optional(),
		prompt: createAMAWithRegularPromptSchema.shape.prompt.optional(),
		prompt_raw: createAMAWithRawPromptSchema.shape.prompt_raw.optional(),
	})
	.refine((data) => Object.keys(data).length > 0, 'At least one field must be provided')
	.refine((data) => !('prompt' in data && 'prompt_raw' in data), 'Cannot provide both prompt and prompt_raw');

export const updateAMABodySchema = z.union([updateAMAEndSchema, updateAMAConfigSchema]);
