import { expect, test } from 'vitest';
import {
	createBlockBodySchema,
	createCategoryBodySchema,
	createPanelBodySchema,
	createSnippetBodySchema,
	updateCategoryBodySchema,
	updateConfigBodySchema,
	updatePanelBodySchema,
	updateSnippetBodySchema,
} from '../schemas.js';

// This whole module is browser-safe by design (only `zod` + `emoji-regex` + the pure `snowflakeSchema`
// regex), which is what lets `apps/website` validate against the exact same rules the API enforces --
// and what lets this test file get away with no mocking at all, unlike everything else under `services/api`.

const CHANNEL = '1425493115053019319';

function issuePaths(result: { error?: { issues: { path: PropertyKey[] }[] } }) {
	return result.error?.issues.map((issue) => issue.path[0]) ?? [];
}

const snippetWithUrl = (attachmentUrl: string) =>
	createSnippetBodySchema.safeParse({ name: 'hi', content: 'hello', attachmentUrl }).success;

const categoryIds = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

test('a category emoji accepts Discord custom-emoji shorthand', () => {
	expect(createCategoryBodySchema.safeParse({ name: 'Support', emoji: `<:wave:${CHANNEL}>` }).success).toBe(true);
	expect(createCategoryBodySchema.safeParse({ name: 'Support', emoji: `<a:dance:${CHANNEL}>` }).success).toBe(true);
});

// `emoji-regex` rather than a hand-rolled pattern precisely so multi-codepoint sequences count as one emoji.
test('a category emoji accepts exactly one unicode emoji, including multi-codepoint sequences', () => {
	for (const emoji of ['👋', '👨‍👩‍👧‍👦', '🇷🇴', '1️⃣', '👋🏽']) {
		expect(createCategoryBodySchema.safeParse({ name: 'Support', emoji }).success).toBe(true);
	}
});

// The routing badge is a single glyph -- letting arbitrary text through here would render as junk on both
// the ticket panel select and the dashboard.
test('a category emoji rejects anything that is not exactly one emoji', () => {
	for (const emoji of ['👋👋', '👋 hi', 'hi', '', ':wave:', `<:wave:${CHANNEL}> extra`]) {
		expect(createCategoryBodySchema.safeParse({ name: 'Support', emoji }).success).toBe(false);
	}
});

test('a category emoji may be explicitly cleared', () => {
	expect(createCategoryBodySchema.safeParse({ name: 'Support', emoji: null }).success).toBe(true);
	expect(createCategoryBodySchema.safeParse({ name: 'Support' }).success).toBe(true);
});

// `sortOrder` defaults only on the create variant: zod v4 keeps a `.default()` live through `.partial()`,
// so sharing one base would make every PATCH that omits it silently reset the order to 0.
test('sortOrder defaults to 0 on create but stays absent on update', () => {
	const created = createCategoryBodySchema.safeParse({ name: 'Support' });
	expect(created.success && created.data.sortOrder).toBe(0);

	const updated = updateCategoryBodySchema.safeParse({ name: 'Renamed' });
	expect(updated.success && 'sortOrder' in updated.data).toBe(false);
});

test('an empty update body is rejected on every partial schema', () => {
	expect(updateCategoryBodySchema.safeParse({}).success).toBe(false);
	expect(updateConfigBodySchema.safeParse({}).success).toBe(false);
	expect(updateSnippetBodySchema.safeParse({}).success).toBe(false);
	expect(updatePanelBodySchema.safeParse({}).success).toBe(false);
});

// `strictObject` everywhere: a typo'd field should 400 rather than be silently dropped and leave the
// caller thinking it saved.
test('unknown keys are rejected rather than stripped', () => {
	expect(updateConfigBodySchema.safeParse({ simpleMode: true, typoField: 1 }).success).toBe(false);
	expect(createCategoryBodySchema.safeParse({ name: 'Support', typoField: 1 }).success).toBe(false);
	expect(createBlockBodySchema.safeParse({ userId: CHANNEL, typoField: 1 }).success).toBe(false);
});

// An attachment url is rendered as a Discord embed's `image.url` directly, so this only has to rule out
// non-http(s) schemes -- but it does have to rule those out.
test('an attachment URL must use http(s)', () => {
	expect(snippetWithUrl('https://cdn.example/a.png')).toBe(true);
	expect(snippetWithUrl('http://cdn.example/a.png')).toBe(true);
	// The scheme under test is the whole point here, so the literal has to stay a literal.
	// eslint-disable-next-line no-script-url
	expect(snippetWithUrl('javascript:alert(1)')).toBe(false);
	expect(snippetWithUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
	expect(snippetWithUrl('not a url at all')).toBe(false);
});

test('an attachment filename requires a URL to hang off', () => {
	const result = createSnippetBodySchema.safeParse({ name: 'hi', content: 'hello', attachmentFilename: 'a.png' });

	expect(result.success).toBe(false);
	expect(issuePaths(result)).toContain('attachmentFilename');

	expect(
		createSnippetBodySchema.safeParse({
			name: 'hi',
			content: 'hello',
			attachmentUrl: 'https://cdn.example/a.png',
			attachmentFilename: 'a.png',
		}).success,
	).toBe(true);
});

// The within-request contradiction this schema *can* see; reconciling against the stored row is
// `updateSnippet.ts`'s job, since that needs the current DB state.
test('a snippet update cannot set a filename while clearing the URL', () => {
	const result = updateSnippetBodySchema.safeParse({ attachmentUrl: null, attachmentFilename: 'a.png' });

	expect(result.success).toBe(false);
	expect(issuePaths(result)).toContain('attachmentFilename');

	expect(updateSnippetBodySchema.safeParse({ attachmentUrl: null, attachmentFilename: null }).success).toBe(true);
});

test('a panel takes either rendered content or raw content', () => {
	expect(
		createPanelBodySchema.safeParse({ channelId: CHANNEL, categoryIds: [1], panel: { title: 'Support' } }).success,
	).toBe(true);

	expect(
		createPanelBodySchema.safeParse({ channelId: CHANNEL, categoryIds: [1], panel_raw: { content: 'hi' } }).success,
	).toBe(true);

	// Neither branch of the union matches a body carrying no panel content at all.
	expect(createPanelBodySchema.safeParse({ channelId: CHANNEL, categoryIds: [1] }).success).toBe(false);
});

test('a panel update cannot carry both panel shapes at once', () => {
	expect(updatePanelBodySchema.safeParse({ panel: { title: 'Support' }, panel_raw: { content: 'hi' } }).success).toBe(
		false,
	);
	expect(updatePanelBodySchema.safeParse({ panel: { title: 'Support' } }).success).toBe(true);
});

test('the button label defaults rather than being required', () => {
	const result = createPanelBodySchema.safeParse({ channelId: CHANNEL, categoryIds: [1], panel: { title: 'Support' } });

	if (!result.success || !('panel' in result.data)) {
		expect.fail('expected the regular-content branch of the union to match');
	}

	expect(result.data.panel.buttonLabel).toBe('Create Ticket');
});

// 25 is Discord's own cap on a string select's `options`, which is exactly how `createTicket.ts` renders a
// panel's categories -- enforced here so a panel can never hold more than the picker could ever show.
test("a panel's category list is bounded by Discord's select limit", () => {
	const panel = { title: 'Support' };

	expect(createPanelBodySchema.safeParse({ channelId: CHANNEL, categoryIds: categoryIds(25), panel }).success).toBe(
		true,
	);
	expect(createPanelBodySchema.safeParse({ channelId: CHANNEL, categoryIds: categoryIds(26), panel }).success).toBe(
		false,
	);
	expect(createPanelBodySchema.safeParse({ channelId: CHANNEL, categoryIds: [], panel }).success).toBe(false);
});

// Upper-bounded to Postgres' `integer` max so an out-of-range value 400s here instead of blowing up at the INSERT.
test('thread limits are bounded to what the column can hold', () => {
	expect(updateConfigBodySchema.safeParse({ maxConcurrentThreads: 2_147_483_647 }).success).toBe(true);
	expect(updateConfigBodySchema.safeParse({ maxConcurrentThreads: 2_147_483_648 }).success).toBe(false);
	expect(updateConfigBodySchema.safeParse({ maxConcurrentThreads: 0 }).success).toBe(false);
	expect(updateConfigBodySchema.safeParse({ maxConcurrentThreads: 1.5 }).success).toBe(false);
});

// A delay in minutes, not a count -- and deletion is opt-in, so `null` (never nuke) has to stay legal.
test('the nuke delay is capped at a year and is nullable', () => {
	expect(updateConfigBodySchema.safeParse({ nukeDelayMinutes: 525_600 }).success).toBe(true);
	expect(updateConfigBodySchema.safeParse({ nukeDelayMinutes: 525_601 }).success).toBe(false);
	expect(updateConfigBodySchema.safeParse({ nukeDelayMinutes: null }).success).toBe(true);
});

test('snowflake fields reject non-snowflakes', () => {
	expect(createBlockBodySchema.safeParse({ userId: CHANNEL }).success).toBe(true);
	expect(createBlockBodySchema.safeParse({ userId: 'not-a-snowflake' }).success).toBe(false);
	expect(updateConfigBodySchema.safeParse({ modForumId: 'nope' }).success).toBe(false);
	// Clearing the mod forum is a legitimate change, so nullable must survive the snowflake check.
	expect(updateConfigBodySchema.safeParse({ modForumId: null }).success).toBe(true);
});

test('a block expiry must be an ISO datetime, or null for permanent', () => {
	expect(createBlockBodySchema.safeParse({ userId: CHANNEL, expiresAt: '2026-08-11T00:00:00.000Z' }).success).toBe(
		true,
	);
	expect(createBlockBodySchema.safeParse({ userId: CHANNEL, expiresAt: null }).success).toBe(true);
	expect(createBlockBodySchema.safeParse({ userId: CHANNEL, expiresAt: '2026-08-11' }).success).toBe(false);
});
