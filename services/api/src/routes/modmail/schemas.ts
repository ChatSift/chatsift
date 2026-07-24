import { z } from 'zod';
import { snowflakeSchema } from '../../util/schemas.js';

/**
 * Browser-safe: only `zod` + the pure `snowflakeSchema` regex, nothing server-only. Exposed to `apps/website` via
 * the `@chatsift/api/modmail-schemas` package export (see `package.json`), mirroring `ama/schemas.ts`'s precedent
 * so the dashboard (M5's #154) validates against the exact same rules the API enforces.
 */

export const updateConfigBodySchema = z
	.strictObject({
		modForumId: snowflakeSchema.nullable().optional(),
		defaultGreetingMessage: z.string().max(2_000).nullable().optional(),
		farewellMessage: z.string().max(2_000).nullable().optional(),
		simpleMode: z.boolean().optional(),
		alertRoleId: snowflakeSchema.nullable().optional(),
	})
	.refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');

// Plain field shape (not a schema) rather than one `categoryBase` object reused via `.partial()` --
// zod v4 keeps a `.default()` live through `.partial()` (a field wrapped `optional(default(...))`
// still substitutes the default when omitted, it doesn't just become `undefined`), which would make
// every category PATCH that omits `sortOrder` silently reset it to `0`. Defining the default only on
// the create variant avoids that.
const categoryFields = {
	name: z.string().min(1).max(100),
	emoji: z.string().max(64).nullable().optional(),
	description: z.string().max(500).nullable().optional(),
	greetingMessage: z.string().max(2_000).nullable().optional(),
	forumTagId: snowflakeSchema.nullable().optional(),
	sortOrder: z.number().int().min(0),
};

export const createCategoryBodySchema = z.strictObject({
	...categoryFields,
	sortOrder: categoryFields.sortOrder.default(0),
});

export const updateCategoryBodySchema = z
	.strictObject(categoryFields)
	.partial()
	.refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');

const panelBase = z.strictObject({
	channelId: snowflakeSchema,
	categoryIds: z.array(z.number().int().positive()).min(1),
});

export const createPanelWithRegularContentSchema = panelBase.safeExtend({
	panel: z.strictObject({
		title: z.string().max(255),
		description: z.string().max(4_000).optional(),
		buttonLabel: z.string().min(1).max(80).default('Create Ticket'),
	}),
});

export const createPanelWithRawContentSchema = panelBase.safeExtend({
	panel_raw: z.strictObject({
		content: z.string().optional(),
		embeds: z.array(z.any()).optional(),
	}),
});

export const createPanelBodySchema = z.union([createPanelWithRegularContentSchema, createPanelWithRawContentSchema]);

export const updatePanelBodySchema = z
	.strictObject({
		categoryIds: z.array(z.number().int().positive()).min(1).optional(),
		panel: createPanelWithRegularContentSchema.shape.panel.optional(),
		panel_raw: createPanelWithRawContentSchema.shape.panel_raw.optional(),
	})
	.refine((data) => Object.keys(data).length > 0, 'At least one field must be provided')
	.refine((data) => !('panel' in data && 'panel_raw' in data), 'Cannot provide both panel and panel_raw');

export const createSnippetBodySchema = z.strictObject({
	name: z.string().min(1).max(100),
	content: z.string().min(1).max(2_000),
	commandId: snowflakeSchema,
});

export const updateSnippetBodySchema = z
	.strictObject({
		name: z.string().min(1).max(100).optional(),
		content: z.string().min(1).max(2_000).optional(),
	})
	.refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');

export const createBlockBodySchema = z.strictObject({
	userId: snowflakeSchema,
	expiresAt: z.iso.datetime().nullable().optional(),
});
