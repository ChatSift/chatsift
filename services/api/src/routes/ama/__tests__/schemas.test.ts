import { expect, test } from 'vitest';
import { createAMABodySchema, hasDiscordMessageSurface, updateAMAConfigSchema } from '../schemas.js';

const CHANNEL = '1425493115053019319';
const OTHER_CHANNEL = '1425493115053019320';

function createBody(overrides: Record<string, unknown> = {}) {
	return {
		title: 'AMA',
		answersChannelId: CHANNEL,
		promptChannelId: OTHER_CHANNEL,
		queueId: null,
		prompt: {},
		...overrides,
	};
}

test('an answers channel is optional (#316)', () => {
	expect(createAMABodySchema.safeParse(createBody({ answersChannelId: null })).success).toBe(true);
});

test('a config with either channel has a Discord message surface', () => {
	expect(hasDiscordMessageSurface({ answersChannelId: CHANNEL, queueId: null })).toBe(true);
	expect(hasDiscordMessageSurface({ answersChannelId: null, queueId: CHANNEL })).toBe(true);
	expect(hasDiscordMessageSurface({ answersChannelId: null, queueId: null })).toBe(false);
});

test('uploads are rejected when no Discord message would ever carry them', () => {
	const result = createAMABodySchema.safeParse(
		createBody({ answersChannelId: null, queueId: null, allowedQuestionUploads: 2 }),
	);

	expect(result.success).toBe(false);
	expect(result.error?.issues.some((issue) => issue.path[0] === 'allowedQuestionUploads')).toBe(true);
});

test('uploads are allowed once either channel exists', () => {
	expect(createAMABodySchema.safeParse(createBody({ allowedQuestionUploads: 2 })).success).toBe(true);
	expect(
		createAMABodySchema.safeParse(
			createBody({ answersChannelId: null, queueId: CHANNEL, reviewEnabled: true, allowedQuestionUploads: 2 }),
		).success,
	).toBe(true);
});

test('zero uploads stay legal with no Discord surface at all', () => {
	expect(
		createAMABodySchema.safeParse(createBody({ answersChannelId: null, queueId: null, allowedQuestionUploads: 0 }))
			.success,
	).toBe(true);
});

// The update path takes null (not just "omitted") so an existing AMA can be switched to public-page-only
// after the fact, mirroring how `queueId` is cleared.
test('an existing AMA can have its answers channel cleared', () => {
	expect(updateAMAConfigSchema.safeParse({ answersChannelId: null }).success).toBe(true);
});
