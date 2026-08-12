import { expect, test } from 'vitest';
import {
	createSocialInteractionBodySchema,
	leaderboardQuerySchema,
	updateSocialConfigBodySchema,
	updateSocialInteractionBodySchema,
	upsertSocialChannelBodySchema,
	upsertSocialRewardBodySchema,
	upsertSocialRoleBodySchema,
} from '../schemas.js';

// Browser-safe by design (only `zod` + the pure `snowflakeSchema`/URL helpers from `util/schemas.ts`), which
// is what lets `apps/website` validate against the exact rules the API enforces -- and what lets this file get
// away with no mocking at all, unlike everything else under `services/api`. Mirrors `modmail/__tests__`.

const CHANNEL = '1425493115053019319';

const interactionWithUrl = (attachmentUrl: string) =>
	createSocialInteractionBodySchema.safeParse({ name: 'hug', content: 'hi', attachmentUrl }).success;

test('config bounds mirror the legacy slash-command options', () => {
	// The exact edges captured in docs/roadmap/10-social-port.md's feature catalog: required-messages 1-15,
	// timespan 1-60s, required-xp-base 1-500, required-xp-multiplier 1-100.
	expect(updateSocialConfigBodySchema.safeParse({ requiredMessages: 15 }).success).toBe(true);
	expect(updateSocialConfigBodySchema.safeParse({ requiredMessages: 16 }).success).toBe(false);
	expect(updateSocialConfigBodySchema.safeParse({ requiredMessagesTimespan: 60 }).success).toBe(true);
	expect(updateSocialConfigBodySchema.safeParse({ requiredMessagesTimespan: 61 }).success).toBe(false);
	expect(updateSocialConfigBodySchema.safeParse({ requiredXpBase: 500 }).success).toBe(true);
	expect(updateSocialConfigBodySchema.safeParse({ requiredXpBase: 501 }).success).toBe(false);
	expect(updateSocialConfigBodySchema.safeParse({ requiredXpMultiplier: 100 }).success).toBe(true);
	expect(updateSocialConfigBodySchema.safeParse({ requiredXpMultiplier: 101 }).success).toBe(false);
});

// Both minimums are also DB CHECKs: a 0 in either makes the level walk non-terminating (schema.sql).
test('the XP curve fields reject the values that would hang level derivation', () => {
	expect(updateSocialConfigBodySchema.safeParse({ requiredXpBase: 0 }).success).toBe(false);
	expect(updateSocialConfigBodySchema.safeParse({ requiredXpMultiplier: 0 }).success).toBe(false);
});

test('config rejects fractional values everywhere', () => {
	expect(updateSocialConfigBodySchema.safeParse({ xpGain: 1.5 }).success).toBe(false);
	expect(updateSocialConfigBodySchema.safeParse({ requiredMessages: 2.5 }).success).toBe(false);
});

// Clearing them back to null is how a guild turns levelling off without losing anyone's XP -- distinct from
// omitting the field, which leaves it alone.
test('the three gate fields may be explicitly cleared', () => {
	const result = updateSocialConfigBodySchema.safeParse({
		requiredMessages: null,
		requiredMessagesTimespan: null,
		xpGain: null,
	});
	expect(result.success).toBe(true);
});

test('config rejects an empty body', () => {
	expect(updateSocialConfigBodySchema.safeParse({}).success).toBe(false);
});

test('config accepts only the three notification modes, matching the DB enum', () => {
	for (const mode of ['NONE', 'DM', 'CHANNEL']) {
		expect(updateSocialConfigBodySchema.safeParse({ levelUpNotificationMode: mode }).success).toBe(true);
	}

	// Legacy's own casing -- the migration uppercases these, so accepting them here would let a value the
	// column can't hold through (see schema.sql's deviation 1).
	for (const mode of ['None', 'Channel', 'channel', 'ANYTHING']) {
		expect(updateSocialConfigBodySchema.safeParse({ levelUpNotificationMode: mode }).success).toBe(false);
	}
});

// An empty template would post a blank message; `null` (use the built-in default) is the way to "unset" it.
test('the level-up message rejects empty string but allows null', () => {
	expect(updateSocialConfigBodySchema.safeParse({ levelUpNotificationMessage: '' }).success).toBe(false);
	expect(updateSocialConfigBodySchema.safeParse({ levelUpNotificationMessage: null }).success).toBe(true);
});

test('the fallback channel must look like a snowflake', () => {
	expect(updateSocialConfigBodySchema.safeParse({ levelUpNotificationFallbackChannelId: CHANNEL }).success).toBe(true);
	expect(updateSocialConfigBodySchema.safeParse({ levelUpNotificationFallbackChannelId: 'nope' }).success).toBe(false);
});

// Full-representation PUTs: an omitted field is the default, not "leave as-is" (see the schema's comment).
test('channel and role upserts default an omitted field rather than leaving it unset', () => {
	const channel = upsertSocialChannelBodySchema.safeParse({});
	expect(channel.success && channel.data).toStrictEqual({ ignored: false, multiplier: 1 });

	const role = upsertSocialRoleBodySchema.safeParse({});
	expect(role.success && role.data).toStrictEqual({ multiplier: 1 });
});

test('a channel multiplier stays within legacy 1-10, and cannot be zero or negative', () => {
	expect(upsertSocialChannelBodySchema.safeParse({ multiplier: 10 }).success).toBe(true);
	expect(upsertSocialChannelBodySchema.safeParse({ multiplier: 11 }).success).toBe(false);
	expect(upsertSocialChannelBodySchema.safeParse({ multiplier: 0 }).success).toBe(false);
	expect(upsertSocialChannelBodySchema.safeParse({ multiplier: -1 }).success).toBe(false);
});

test('a reward needs a level of at least 1 and defaults to non-clean', () => {
	const reward = upsertSocialRewardBodySchema.safeParse({ level: 5 });
	expect(reward.success).toBe(true);
	expect(reward.data?.clean).toBe(false);
	expect(upsertSocialRewardBodySchema.safeParse({ level: 0 }).success).toBe(false);
	expect(upsertSocialRewardBodySchema.safeParse({}).success).toBe(false);
});

// Discord's own rule for a CHAT_INPUT command name -- an interaction's name *is* the command name, so a bad
// one has to 400 here rather than being rejected by Discord at registration time.
test('an interaction name must be a valid lowercase command name', () => {
	for (const name of ['hug', 'high-five', 'pat_pat', 'a'.repeat(32)]) {
		expect(createSocialInteractionBodySchema.safeParse({ name, content: 'hi' }).success).toBe(true);
	}

	for (const name of ['Hug', 'high five', 'hug!', '', 'a'.repeat(33), 'ハグ']) {
		expect(createSocialInteractionBodySchema.safeParse({ name, content: 'hi' }).success).toBe(false);
	}
});

test('an interaction color must be a hex color, and may be cleared', () => {
	expect(createSocialInteractionBodySchema.safeParse({ name: 'hug', content: 'hi', color: '#7289da' }).success).toBe(
		true,
	);
	expect(createSocialInteractionBodySchema.safeParse({ name: 'hug', content: 'hi', color: 'blurple' }).success).toBe(
		false,
	);
	expect(createSocialInteractionBodySchema.safeParse({ name: 'hug', content: 'hi', color: '7289da' }).success).toBe(
		false,
	);
	expect(updateSocialInteractionBodySchema.safeParse({ color: null }).success).toBe(true);
});

// The attachment ends up as an embed `image.url` Discord fetches -- the shared rule only rules out non-http(s)
// schemes (see `util/schemas.ts`).
test('an interaction attachment URL must use http(s)', () => {
	expect(interactionWithUrl('https://cdn.discordapp.com/x.png')).toBe(true);
	expect(interactionWithUrl('http://example.com/x.png')).toBe(true);
	// eslint-disable-next-line no-script-url
	expect(interactionWithUrl('javascript:alert(1)')).toBe(false);
	expect(interactionWithUrl('data:image/png;base64,AAAA')).toBe(false);
	expect(interactionWithUrl('not a url')).toBe(false);
});

test('interaction booleans default to false on create', () => {
	const created = createSocialInteractionBodySchema.safeParse({ name: 'hug', content: 'hi' });
	expect(created.success && created.data).toMatchObject({ embed: false, allowTargets: false });
});

// zod v4 keeps a `.default()` live through `.partial()`, so sharing the create schema would make every PATCH
// that omits these silently reset them -- the same trap `modmail/schemas.ts` documents for `sortOrder`.
test('an interaction update leaves omitted booleans absent instead of defaulting them', () => {
	const updated = updateSocialInteractionBodySchema.safeParse({ content: 'new content' });
	expect(updated.success).toBe(true);
	// Exact-shape rather than two `in` checks, so a defaulted key can't slip through as `false === false`.
	expect(updated.data).toStrictEqual({ content: 'new content' });
});

test('an interaction update rejects an empty body', () => {
	expect(updateSocialInteractionBodySchema.safeParse({}).success).toBe(false);
});

test('the public leaderboard toggle is a plain optional boolean', () => {
	expect(updateSocialConfigBodySchema.safeParse({ publicLeaderboard: true }).success).toBe(true);
	expect(updateSocialConfigBodySchema.safeParse({ publicLeaderboard: false }).success).toBe(true);
	// Not nullable, unlike every other field on this schema: the column is NOT NULL DEFAULT false, so "off"
	// is a real value rather than an absence, and `null` would have to mean the same thing as `false`.
	expect(updateSocialConfigBodySchema.safeParse({ publicLeaderboard: null }).success).toBe(false);
});

// Query params arrive as strings, hence the coercion -- a schema that only accepted numbers would reject
// every real request.
test('leaderboard paging coerces strings and defaults to the first page', () => {
	const parsed = leaderboardQuerySchema.safeParse({});
	expect(parsed.success && parsed.data).toStrictEqual({ limit: 25, offset: 0 });

	const coerced = leaderboardQuerySchema.safeParse({ limit: '50', offset: '75' });
	expect(coerced.success && coerced.data).toStrictEqual({ limit: 50, offset: 75 });
});

// The cap exists because each row costs a `GET /users/{id}` against a 30-per-30s bucket -- an unbounded
// `limit` would be a way for one request to stall the whole token's user lookups.
test('leaderboard paging rejects an oversized or nonsensical page', () => {
	expect(leaderboardQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
	expect(leaderboardQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
	expect(leaderboardQuerySchema.safeParse({ offset: -1 }).success).toBe(false);
	expect(leaderboardQuerySchema.safeParse({ limit: 10.5 }).success).toBe(false);
});

// `offset` is anonymous-caller-controlled on the public route, so it's bounded to a range a human could
// actually walk rather than left open to `Number.MAX_SAFE_INTEGER`.
test('leaderboard paging bounds how deep an offset may go', () => {
	expect(leaderboardQuerySchema.safeParse({ offset: 100_000 }).success).toBe(true);
	expect(leaderboardQuerySchema.safeParse({ offset: 100_001 }).success).toBe(false);
	expect(leaderboardQuerySchema.safeParse({ offset: Number.MAX_SAFE_INTEGER }).success).toBe(false);
});
