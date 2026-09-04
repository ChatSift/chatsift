import emojiRegex from 'emoji-regex';
import { z } from 'zod';
import { embedColorSchema, httpUrlSchema, snowflakeSchema } from '../../util/schemas.js';

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

// Shared by a snippet's `attachmentUrl` and a normal-mode panel's `attachmentUrl` below -- both end up as
// a Discord embed's `image.url` directly. The rule itself lives in `util/schemas.ts` (its doc comment covers
// why this only checks the scheme), since social interactions need the identical one.
const attachmentUrlSchema = httpUrlSchema;

export const updateConfigBodySchema = z
	.strictObject({
		modForumId: snowflakeSchema.nullable().optional(),
		defaultGreetingMessage: z.string().max(2_000).nullable().optional(),
		farewellMessage: z.string().max(2_000).nullable().optional(),
		simpleMode: z.boolean().optional(),
		alertRoleId: snowflakeSchema.nullable().optional(),
		anonReplyLabel: z.string().max(100).nullable().optional(),
		// How many tickets a single user may have open at once in this guild, summed across all
		// categories -- categories may only tighten this further (see `maxConcurrentThreads` below),
		// never exceed it. Upper-bounded to Postgres' `integer` max so an out-of-range value 400s here
		// instead of erroring at the INSERT.
		maxConcurrentThreads: z.number().int().min(1).max(2_147_483_647).optional(),
		// How long, after a ticket closes, before its private thread is actually deleted -- see
		// `scheduled_thread_nukes`. Capped well below the general integer max (unlike the two fields
		// above): this is a delay in minutes, not a count, and a year is already an absurdly generous
		// upper bound for "give staff time to double check before this gets nuked". Deletion is opt-in:
		// `null` (the default) means never nuke the private thread at all, rather than merely delaying it.
		nukeDelayMinutes: z.number().int().min(1).max(525_600).nullable().optional(),
		// Whether the greeting (category's, falling back to defaultGreetingMessage) is posted before the
		// user's own opener message is relayed to staff, instead of after. Defaults to false (after).
		greetingBeforeOpener: z.boolean().optional(),
		// Consent toggle for recording full message content (see `thread_message_content`, #261) -- a real
		// privacy decision, so this is opt-in per guild rather than defaulted on. `updateConfig.ts` stamps
		// `recordThreadContentEnabledBy`/`EnabledAt` server-side (from the caller's own token) only on the
		// false->true transition; both are left untouched on a later disable.
		recordThreadContent: z.boolean().optional(),
		// Whether this guild's ModMail runs on the DM front door instead of ticket panels (#216, P4). Only
		// settable true for a guild with a `modmail_instances` row -- `updateConfig.ts` 400s otherwise, since
		// the public deployment never reads this column at all.
		dmMode: z.boolean().optional(),
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
	// Overrides the guild's general `maxConcurrentThreads` for tickets in this category specifically;
	// must be <= the guild's current value (validated server-side against `guild_settings`, since it
	// depends on data outside this body). `null`/omitted means "inherit the guild's general limit".
	// Same Postgres `integer` upper bound as the guild-level field above.
	maxConcurrentThreads: z.number().int().min(1).max(2_147_483_647).nullable().optional(),
};

export const createCategoryBodySchema = z.strictObject({
	...categoryFields,
	sortOrder: categoryFields.sortOrder.default(0),
});

export const updateCategoryBodySchema = z
	.strictObject(categoryFields)
	.partial()
	.refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');

// Capped at 25 -- Discord's own limit on a string select's `options` array, which is exactly how
// `services/modmail-bot`'s `createTicket.ts` renders a panel's categories as a picker. Enforced here
// (and inherited by the dashboard forms below, which validate against this exact schema) rather than
// in the bot, so a panel can never end up with more categories attached than the picker could ever
// render, instead of the bot silently truncating the list at select-build time.
const panelBase = z.strictObject({
	channelId: snowflakeSchema,
	categoryIds: z.array(z.number().int().positive()).min(1).max(25),
});

/**
 * The structured panel embed. Both text fields are optional but neither may be empty, and at least one of them
 * has to be there: Discord refuses an embed carrying no content of its own (a panel submitted with an empty
 * title and no description came back as `embeds[0].description[BASE_TYPE_REQUIRED]`, which reached the
 * dashboard as a 500), so the rule is enforced here -- once, for the create form, the edit form and the API --
 * rather than left to Discord to answer with. Same shape `automoderator/schemas.ts`'s report prompt already
 * uses.
 */
const panelContentSchema = z
	.strictObject({
		title: z.string().min(1).max(255).optional(),
		description: z.string().min(1).max(4_000).optional(),
		buttonLabel: z.string().min(1).max(80).default('Create Ticket'),
		// Rendered as the embed's `image.url` directly (`createPanel.ts`/`updatePanel.ts`), same as a
		// snippet's `attachmentUrl` -- see `isHttpUrl`'s doc comment above. The edit form always resends
		// the full `panel` object, so omitting this (rather than needing a `null` to clear) is enough to
		// drop an existing image.
		attachmentUrl: attachmentUrlSchema.optional(),
		// The embed's small corner image, as opposed to `attachmentUrl`'s full-width one. Same
		// omit-to-clear semantics and the same URL rule.
		thumbnailUrl: attachmentUrlSchema.optional(),
		// Omitted means `DEFAULT_EMBED_COLOR` (see `createPanel.ts`), not "leave whatever was there" --
		// consistent with every other field on this object, which the edit form always resends in full.
		color: embedColorSchema.optional(),
	})
	// Blamed on `title` so the dashboard renders it under the first of the two fields it's about, rather than
	// as a form-level error with no field to point at (`PanelEmbedFields`).
	.refine((panel) => Boolean(panel.title ?? panel.description), {
		message: 'A panel needs a title, a description, or both',
		path: ['title'],
	});

export const createPanelWithRegularContentSchema = panelBase.safeExtend({
	panel: panelContentSchema,
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
		categoryIds: z.array(z.number().int().positive()).min(1).max(25).optional(),
		panel: panelContentSchema.optional(),
		panel_raw: createPanelWithRawContentSchema.shape.panel_raw.optional(),
	})
	.refine((data) => Object.keys(data).length > 0, 'At least one field must be provided')
	.refine((data) => !('panel' in data && 'panel_raw' in data), 'Cannot provide both panel and panel_raw');

export const createSnippetBodySchema = z
	.strictObject({
		name: z.string().min(1).max(32),
		content: z.string().min(1).max(2_000),
		attachmentUrl: attachmentUrlSchema.optional(),
		attachmentFilename: z.string().min(1).max(256).optional(),
	})
	.refine((data) => !data.attachmentFilename || data.attachmentUrl, {
		message: 'attachmentFilename requires attachmentUrl to also be set',
		path: ['attachmentFilename'],
	});

export const updateSnippetBodySchema = z
	.strictObject({
		name: z.string().min(1).max(32).optional(),
		content: z.string().min(1).max(2_000).optional(),
		attachmentUrl: attachmentUrlSchema.nullable().optional(),
		attachmentFilename: z.string().min(1).max(256).nullable().optional(),
	})
	.refine((data) => Object.keys(data).length > 0, 'At least one field must be provided')
	// Only catches the contradiction within a single request (clearing the URL while setting a filename
	// in the same payload) -- reconciling against a snippet's *existing* stored URL needs the current DB
	// row, which this schema can't see, so `updateSnippet.ts`'s handler additionally clears a stale
	// filename whenever the resolved URL ends up null.
	.refine((data) => !(data.attachmentUrl === null && data.attachmentFilename), {
		message: 'attachmentFilename cannot be set while clearing attachmentUrl',
		path: ['attachmentFilename'],
	});

export const createBlockBodySchema = z.strictObject({
	userId: snowflakeSchema,
	expiresAt: z.iso.datetime().nullable().optional(),
});
