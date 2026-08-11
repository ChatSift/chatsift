import type { APIEmbed, APIGuildMember, APIMessage, APIUser } from 'discord-api-types/v10';
import { ButtonStyle, ComponentType, RouteBases } from 'discord-api-types/v10';
import { expect, test } from 'vitest';
import {
	BLURPLE,
	createButtonActionRow,
	GALLERY_ANCHOR_URL,
	getAnswerEmbed,
	getBaseEmbeds,
	resolveQuestionImageSources,
	withResolvedActionRow,
} from '../amaEmbeds.js';

const GUILD = '1425493115053019319';
const USER_ID = '1425493115053019320';

function user(overrides: Partial<APIUser> = {}): APIUser {
	return {
		id: USER_ID,
		username: 'didinele',
		discriminator: '0',
		global_name: null,
		avatar: null,
		...overrides,
	} as APIUser;
}

function member(overrides: Partial<APIGuildMember> = {}): APIGuildMember {
	return {
		nick: null,
		avatar: null,
		roles: [],
		joined_at: '2024-01-01T00:00:00.000Z',
		deaf: false,
		mute: false,
		flags: 0,
		...overrides,
	} as APIGuildMember;
}

function attachments(count: number) {
	return Array.from({ length: count }, (_, index) => ({ url: `https://cdn.example/${index}.png` }));
}

test('the author line prefers a nick over the global name over the username', () => {
	const base = { attachments: [], content: 'why?', guildId: GUILD };

	expect(
		getBaseEmbeds({ ...base, member: member({ nick: 'Nick' }), user: user({ global_name: 'Global' }) })[0]!.author,
	).toStrictEqual({ name: 'Nick' });
	expect(getBaseEmbeds({ ...base, user: user({ global_name: 'Global' }) })[0]!.author).toStrictEqual({
		name: 'Global',
	});
	expect(getBaseEmbeds({ ...base, user: user() })[0]!.author).toStrictEqual({ name: 'didinele' });
});

// A question whose author the caller couldn't resolve at all still has to render -- every publish path
// takes `user` as optional precisely so an unresolvable id doesn't sink the whole message.
test('an unresolvable author renders as Unknown User', () => {
	expect(getBaseEmbeds({ attachments: [], content: 'why?', guildId: GUILD })[0]!.author).toStrictEqual({
		name: 'Unknown User',
	});
});

test('the guild-specific avatar wins over the global one', () => {
	const withGuildAvatar = getBaseEmbeds({
		attachments: [],
		content: 'why?',
		guildId: GUILD,
		member: member({ avatar: 'guildhash', user: user({ avatar: 'globalhash' }) }),
		user: user({ avatar: 'globalhash' }),
	});

	expect(withGuildAvatar[0]!.author!.icon_url).toBe(
		`${RouteBases.cdn}/guilds/${GUILD}/users/${USER_ID}/avatars/guildhash.png`,
	);

	const globalOnly = getBaseEmbeds({
		attachments: [],
		content: 'why?',
		guildId: GUILD,
		member: member({ avatar: null }),
		user: user({ avatar: 'globalhash' }),
	});

	expect(globalOnly[0]!.author!.icon_url).toBe(`${RouteBases.cdn}/avatars/${USER_ID}/globalhash.png`);
});

// A guild avatar hash with no `member.user` alongside it can't be turned into a url (the CDN route needs
// the user id, which only lives on `member.user` here) -- it has to fall through rather than throw.
test('a guild avatar without a member user falls back to the global avatar', () => {
	const embeds = getBaseEmbeds({
		attachments: [],
		content: 'why?',
		guildId: GUILD,
		member: member({ avatar: 'guildhash' }),
		user: user({ avatar: 'globalhash' }),
	});

	expect(embeds[0]!.author!.icon_url).toBe(`${RouteBases.cdn}/avatars/${USER_ID}/globalhash.png`);
});

test('an avatarless author gets no icon_url at all', () => {
	const embeds = getBaseEmbeds({ attachments: [], content: 'why?', guildId: GUILD, user: user() });

	expect(embeds[0]!.author).toStrictEqual({ name: 'didinele' });
	expect(embeds[0]!.color).toBe(BLURPLE);
});

// The raw user id is mod-facing only -- `includeUserId` is exactly what separates the queue surface from
// the public answers channel, so a stray `true` here would leak an asker's id onto a public message.
test('the raw user id footer is opt-in and needs a resolved user', () => {
	const base = { attachments: [], content: 'why?', guildId: GUILD };

	expect(getBaseEmbeds({ ...base, includeUserId: true, user: user() })[0]!.footer).toStrictEqual({
		text: `didinele (${USER_ID})`,
	});
	expect(getBaseEmbeds({ ...base, user: user() })[0]!.footer).toBeUndefined();
	expect(getBaseEmbeds({ ...base, includeUserId: true })[0]!.footer).toBeUndefined();
});

test('the footer carries the avatar when there is one', () => {
	const embeds = getBaseEmbeds({
		attachments: [],
		content: 'why?',
		guildId: GUILD,
		includeUserId: true,
		user: user({ avatar: 'globalhash' }),
	});

	expect(embeds[0]!.footer).toStrictEqual({
		text: `didinele (${USER_ID})`,
		icon_url: `${RouteBases.cdn}/avatars/${USER_ID}/globalhash.png`,
	});
});

test('merged-duplicate askers render as a count, pluralized (#326)', () => {
	const base = { attachments: [], content: 'why?', guildId: GUILD, user: user() };

	expect(getBaseEmbeds({ ...base, extraAskerCount: 1 })[0]!.fields).toStrictEqual([
		{ name: 'Also asked by', value: '1 other person', inline: false },
	]);
	expect(getBaseEmbeds({ ...base, extraAskerCount: 4 })[0]!.fields).toStrictEqual([
		{ name: 'Also asked by', value: '4 other people', inline: false },
	]);
	expect(getBaseEmbeds({ ...base, extraAskerCount: 0 })[0]!.fields).toBeUndefined();
	expect(getBaseEmbeds(base)[0]!.fields).toBeUndefined();
});

// Regression guard for the ordering the source comment calls out: the asker field is set *before* the
// no-attachments early return, so the common attachment-less question can't silently lose it.
test('the asker count survives on an attachment-less question', () => {
	const embeds = getBaseEmbeds({
		attachments: [],
		content: 'why?',
		extraAskerCount: 2,
		guildId: GUILD,
		user: user(),
	});

	expect(embeds).toHaveLength(1);
	expect(embeds[0]!.fields).toStrictEqual([{ name: 'Also asked by', value: '2 other people', inline: false }]);
});

test('a single attachment goes straight onto the main embed with no gallery anchor', () => {
	const embeds = getBaseEmbeds({ attachments: attachments(1), content: 'why?', guildId: GUILD, user: user() });

	expect(embeds).toHaveLength(1);
	expect(embeds[0]!.image).toStrictEqual({ url: 'https://cdn.example/0.png' });
	expect(embeds[0]!.url).toBeUndefined();
});

// Discord only groups embeds into one image gallery when they share an identical `url`, so every embed in
// a multi-attachment question must carry the exact same anchor -- that shared value *is* the mechanism.
test('multiple attachments render as a gallery sharing one anchor url', () => {
	const embeds = getBaseEmbeds({ attachments: attachments(3), content: 'why?', guildId: GUILD, user: user() });

	expect(embeds).toHaveLength(3);
	expect(embeds.every((embed) => embed.url === GALLERY_ANCHOR_URL)).toBe(true);
	expect(embeds.map((embed) => embed.image!.url)).toStrictEqual([
		'https://cdn.example/0.png',
		'https://cdn.example/1.png',
		'https://cdn.example/2.png',
	]);
	// Only the main embed carries the question text; the gallery embeds exist purely to hold an image.
	expect(embeds[1]!.description).toBeUndefined();
	expect(embeds[1]!.color).toBe(BLURPLE);
});

test("a gallery is capped at Discord's 10 embeds per message", () => {
	const embeds = getBaseEmbeds({ attachments: attachments(15), content: 'why?', guildId: GUILD, user: user() });

	expect(embeds).toHaveLength(10);
});

// `reserveEmbedSlots` is what stops `buildQuestionEmbeds` blowing the cap when it appends `getAnswerEmbed`'s
// result onto a question that already has the maximum number of attachments.
test('reserved slots come out of the gallery budget', () => {
	const embeds = getBaseEmbeds({
		attachments: attachments(15),
		content: 'why?',
		guildId: GUILD,
		reserveEmbedSlots: 1,
		user: user(),
	});

	expect(embeds).toHaveLength(9);
});

// Reserving everything can't produce a negative slice length -- `Math.max(0, ...)` keeps the main embed alone.
test('reserving more slots than exist still yields the main embed', () => {
	const embeds = getBaseEmbeds({
		attachments: attachments(5),
		content: 'why?',
		guildId: GUILD,
		reserveEmbedSlots: 20,
		user: user(),
	});

	expect(embeds).toHaveLength(1);
	expect(embeds[0]!.image).toStrictEqual({ url: 'https://cdn.example/0.png' });
});

test('the answer embed footers with who answered', () => {
	expect(getAnswerEmbed({ answerContent: 'because', answeredByDisplayName: 'Mod' })).toStrictEqual({
		color: BLURPLE,
		description: 'because',
		footer: { text: 'Mod answered' },
	});

	expect(
		getAnswerEmbed({
			answerContent: 'because',
			answeredByAvatarURL: 'https://cdn.example/mod.png',
			answeredByDisplayName: 'Mod',
		}),
	).toStrictEqual({
		color: BLURPLE,
		description: 'because',
		footer: { text: 'Mod answered', icon_url: 'https://cdn.example/mod.png' },
	});
});

test('the answer embed only carries an image when one was prepared', () => {
	const withImage = getAnswerEmbed({
		answerContent: 'because',
		answerImageUrl: 'https://cdn.example/answer.png',
		answeredByDisplayName: 'Mod',
	});
	expect(withImage.image).toStrictEqual({ url: 'https://cdn.example/answer.png' });

	// `answer_image_url` is a nullable column, so `null` reaches here far more often than `undefined` does.
	expect(
		getAnswerEmbed({ answerContent: 'because', answerImageUrl: null, answeredByDisplayName: 'Mod' }).image,
	).toBeUndefined();
	expect(getAnswerEmbed({ answerContent: 'because', answeredByDisplayName: 'Mod' }).image).toBeUndefined();
});

function message(overrides: Partial<Pick<APIMessage, 'attachments' | 'embeds'>> = {}) {
	return { attachments: [], embeds: [], ...overrides } as Pick<APIMessage, 'attachments' | 'embeds'>;
}

test('real attachments win over embed images when the message has them', () => {
	const source = message({
		attachments: [{ url: 'https://cdn.example/real.png' }] as APIMessage['attachments'],
		embeds: [{ image: { url: 'https://cdn.example/embed.png' } }] as APIEmbed[],
	});

	expect(resolveQuestionImageSources(source, false)).toStrictEqual([{ url: 'https://cdn.example/real.png' }]);
});

// The answers-channel message is created with `{ embeds }` and no files at all, so its own `attachments`
// array is empty -- reading images back off it has to go through the embeds or they're silently dropped.
test('an attachment-less message recovers its images from its embeds', () => {
	const source = message({
		embeds: [
			{ image: { url: 'https://cdn.example/0.png' } },
			{ image: { url: 'https://cdn.example/1.png' } },
		] as APIEmbed[],
	});

	expect(resolveQuestionImageSources(source, false)).toStrictEqual([
		{ url: 'https://cdn.example/0.png' },
		{ url: 'https://cdn.example/1.png' },
	]);
});

// The trailing answer embed's image is the *answer's* own (rebuilt from `answer_image_url`), not part of
// the question -- keeping it here would duplicate it onto the question every re-render.
test('the trailing answer embed is sliced off when the message has one', () => {
	const source = message({
		embeds: [
			{ image: { url: 'https://cdn.example/question.png' } },
			{ image: { url: 'https://cdn.example/answer.png' } },
		] as APIEmbed[],
	});

	expect(resolveQuestionImageSources(source, true)).toStrictEqual([{ url: 'https://cdn.example/question.png' }]);
});

test('embeds with no image contribute nothing', () => {
	const source = message({ embeds: [{ description: 'text only' }, { image: { url: 'a' } }] as APIEmbed[] });

	expect(resolveQuestionImageSources(source, false)).toStrictEqual([{ url: 'a' }]);
	expect(resolveQuestionImageSources(message(), false)).toStrictEqual([]);
});

const disabledButton = {
	type: ComponentType.Button,
	style: ButtonStyle.Secondary,
	custom_id: 'resolved',
	label: 'Approved',
	disabled: true,
} as const;

test('createButtonActionRow wraps buttons in an action row', () => {
	expect(createButtonActionRow([disabledButton])).toStrictEqual({
		type: ComponentType.ActionRow,
		components: [disabledButton],
	});
});

// The question container has to survive the swap -- an earlier shape that rebuilt `components` wholesale
// dropped the question itself off the queue message the moment a mod acted on it.
test('resolving a queue message swaps only the action row, keeping everything else', () => {
	const container = { type: ComponentType.Container, components: [] } as never;
	const original = [
		container,
		{ type: ComponentType.ActionRow, components: [{ ...disabledButton, custom_id: 'approve', disabled: false }] },
	] as never[];

	const resolved = withResolvedActionRow(original, disabledButton);

	expect(resolved).toHaveLength(2);
	expect(resolved[0]).toBe(container);
	expect(resolved[1]).toStrictEqual({ type: ComponentType.ActionRow, components: [disabledButton] });
});

test('a message with no components at all resolves to nothing', () => {
	expect(withResolvedActionRow(undefined, disabledButton)).toStrictEqual([]);
});
