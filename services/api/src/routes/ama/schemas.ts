import { z } from 'zod';
import { embedColorSchema, snowflakeSchema } from '../../util/schemas.js';

/**
 * Browser-safe: only `zod` + the pure `snowflakeSchema` regex, nothing server-only. Exposed to `apps/website` via
 * the `@chatsift/api/ama-schemas` package export (see `package.json`) so the dashboard validates against the exact
 * same rules the API enforces, without pulling the rest of this package (bcrypt, jsonwebtoken, discord.js REST,
 * route handlers, ...) into a client bundle.
 *
 * Note: the duplicate-merge state sets used to live here for the same "share it with the dashboard" reason, but
 * `services/ama-bot` needs them too and doesn't depend on this package -- they're in `@chatsift/core`'s
 * `amaMerge.ts` now, which all three consumers share.
 */

const createAMABase = z.strictObject({
	queueId: snowflakeSchema.nullable(),
	title: z.string().min(1).max(255),
	// Nullable since #316: no answers channel means this AMA publishes nowhere on Discord and the public
	// answers page is the only surface an answer reaches. See schema.sql's comment on the column.
	answersChannelId: snowflakeSchema.nullable(),
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
		// Omitted means `DEFAULT_EMBED_COLOR` (see `createAMA.ts`), not "leave whatever was there" -- the
		// edit form always resends the full `prompt` object, same as every other field here.
		color: embedColorSchema.optional(),
	}),
});

export const createAMAWithRawPromptSchema = createAMABase.safeExtend({
	prompt_raw: z.strictObject({
		content: z.string().optional(),
		embeds: z.array(z.any()).optional(),
	}),
});

/**
 * Whether an AMA with this channel configuration ever puts a question on a Discord message at all
 * (#316). Attachments are never persisted on `ama_questions` -- every consumer reads them back off
 * whichever live message currently shows the question (`questions/util.ts`'s
 * `resolveQuestionAttachments`), so with neither channel configured an upload would be accepted from
 * the submit modal and then silently dropped. Uploads are therefore refused outright in that
 * combination rather than half-working.
 *
 * Exported (and browser-safe, like the rest of this module) so the dashboard can disable its uploads
 * field off the exact same rule the API enforces, instead of re-deriving the condition.
 */
export function hasDiscordMessageSurface(config: {
	answersChannelId?: string | null | undefined;
	queueId?: string | null | undefined;
}): boolean {
	return Boolean(config.answersChannelId ?? config.queueId);
}

export const UPLOADS_WITHOUT_DISCORD_SURFACE_MESSAGE =
	'File uploads need either an answers channel or a review queue -- attachments live on the Discord message, so an AMA that posts nowhere has no way to keep them';

export const createAMABodySchema = z
	.union([createAMAWithRegularPromptSchema, createAMAWithRawPromptSchema])
	.refine((data) => data.reviewEnabled || !data.queueId, {
		message: 'queueId can only be set when reviewEnabled is true',
		path: ['queueId'],
	})
	.refine((data) => hasDiscordMessageSurface(data) || data.allowedQuestionUploads === 0, {
		message: UPLOADS_WITHOUT_DISCORD_SURFACE_MESSAGE,
		path: ['allowedQuestionUploads'],
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
		// `.nullable()` as well as `.optional()` (mirroring `queueId`) so an existing AMA can be switched to
		// public-page-only after the fact, not just created that way (#316).
		answersChannelId: snowflakeSchema.nullable().optional(),
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
