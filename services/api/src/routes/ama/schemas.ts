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
	allowedQuestionUploads: z.number().min(0).max(10).default(0),
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

export const createAMABodySchema = z.union([createAMAWithRegularPromptSchema, createAMAWithRawPromptSchema]);

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
		allowedQuestionUploads: z.number().min(0).max(10).optional(),
	})
	.refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');

export const updateAMABodySchema = z.union([updateAMAEndSchema, updateAMAConfigSchema]);
