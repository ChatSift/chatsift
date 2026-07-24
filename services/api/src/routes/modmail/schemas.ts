import emojiRegex from 'emoji-regex';
import { z } from 'zod';
import { snowflakeSchema } from '../../util/schemas.js';

/**
 * Browser-safe: only `zod` + the pure `snowflakeSchema` regex, nothing server-only. Exposed to `apps/website` via
 * the `@chatsift/api/modmail-schemas` package export (see `package.json`), mirroring `ama/schemas.ts`'s precedent
 * so the dashboard (M5's #154) validates against the exact same rules the API enforces.
 */

// Discord's own shorthand for a custom guild emoji as it appears in message content (`<:name:id>`, or `<a:...>`
// for animated) -- the dashboard's emoji picker writes this exact shape (see `EmojiInput.tsx`), so accepting it
// here is what lets a category be routed to an emoji from any guild the bot is in, not just typed unicode.
const DISCORD_CUSTOM_EMOJI_REGEX = /^<a?:\w{2,32}:\d{17,20}>$/;

/**
 * A category's `emoji` must be either a Discord custom-emoji shorthand or exactly one real unicode emoji
 * (including multi-codepoint sequences like ZWJ combinations, skin-tone modifiers, flags, and keycaps) -- not
 * arbitrary text. `emoji-regex` (mathiasbynens' package, kept in sync with the Unicode emoji spec) is used rather
 * than a hand-rolled pattern since correctly matching every emoji sequence shape isn't something worth
 * re-deriving here.
 */
function isValidCategoryEmoji(value: string): boolean {
	if (DISCORD_CUSTOM_EMOJI_REGEX.test(value)) {
		return true;
	}

	const matches = [...value.matchAll(emojiRegex())];
	return matches.length === 1 && matches[0]![0] === value;
}

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
	emoji: z
		.string()
		.max(64)
		.refine(isValidCategoryEmoji, 'Must be a single unicode emoji or a custom emoji from a server the bot is in')
		.nullable()
		.optional(),
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

// A snippet's name becomes the name of the Discord slash command registered for it (e.g. a snippet
// named `reportuser` is invoked as `/reportuser`), so it's bound by Discord's own command-name rules
// rather than an arbitrary display-name length -- see createSnippet.ts.
export const createSnippetBodySchema = z.strictObject({
	name: z.string().min(1).max(32),
	content: z.string().min(1).max(2_000),
});

export const updateSnippetBodySchema = z
	.strictObject({
		name: z.string().min(1).max(32).optional(),
		content: z.string().min(1).max(2_000).optional(),
	})
	.refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');

export const createBlockBodySchema = z.strictObject({
	userId: snowflakeSchema,
	expiresAt: z.iso.datetime().nullable().optional(),
});
