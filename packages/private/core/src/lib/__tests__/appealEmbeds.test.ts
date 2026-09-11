import type { APIButtonComponent } from 'discord-api-types/v10';
import { ButtonStyle, ComponentType } from 'discord-api-types/v10';
import { expect, test } from 'vitest';
import type { AppealAnswerInput, AppealEmbedInput } from '../appealEmbeds.js';
import { buildAppealComponents, buildAppealEmbed, buildAppealThreadName } from '../appealEmbeds.js';
import { APPEAL_ANSWER_MAX_LENGTH } from '../constants.js';

function makeAppeal(overrides: Partial<AppealEmbedInput> = {}): AppealEmbedInput {
	return {
		id: 12,
		userId: '2',
		status: 'PENDING',
		silent: false,
		reasonSnapshot: 'ban evasion',
		decidedAt: null,
		decidedById: null,
		decisionReason: null,
		createdAt: new Date('2026-09-11T00:00:00.000Z'),
		...overrides,
	};
}

function makeAnswer(overrides: Partial<AppealAnswerInput> = {}): AppealAnswerInput {
	return { position: 0, promptSnapshot: 'Why were you banned?', answer: 'I was not', ...overrides };
}

function buttons(appeal: AppealEmbedInput): APIButtonComponent[] {
	const [row] = buildAppealComponents(appeal);
	expect(row!.type).toBe(ComponentType.ActionRow);

	return (row as unknown as { components: APIButtonComponent[] }).components;
}

test('a pending appeal offers all three decisions', () => {
	const labels = buttons(makeAppeal()).map((button) => ('label' in button ? button.label : null));

	expect(labels).toStrictEqual(['Approve', 'Deny', 'Deny silently']);
	expect(buttons(makeAppeal()).every((button) => button.disabled !== true)).toBe(true);
});

test('every decision is terminal, so a decided card keeps its buttons and disables them', () => {
	for (const status of ['APPROVED', 'DENIED', 'MOOT', 'WITHDRAWN'] as const) {
		const decided = buttons(makeAppeal({ status }));

		expect(decided).toHaveLength(3);
		expect(decided.every((button) => button.disabled === true)).toBe(true);
	}
});

function linkedButtons(appeal: AppealEmbedInput): APIButtonComponent[] {
	const [row] = buildAppealComponents(appeal, { dashboardLink: 'https://example.test/appeal' });

	return (row as unknown as { components: APIButtonComponent[] }).components;
}

test('the dashboard link is a link button, and it survives the card being decided', () => {
	const [first] = linkedButtons(makeAppeal());
	expect(first).toMatchObject({ style: ButtonStyle.Link, label: 'View in dashboard' });

	// A link button cannot be disabled, and should not be: the history is worth reading after the decision.
	expect(linkedButtons(makeAppeal({ status: 'DENIED' }))[0]!.disabled).toBeUndefined();
});

test('no link is passed, no button is rendered', () => {
	expect(buttons(makeAppeal())).toHaveLength(3);
});

test('an appeal closed as moot says the ban was lifted elsewhere, and blames nobody', () => {
	const embed = buildAppealEmbed(makeAppeal({ status: 'MOOT', decidedAt: new Date('2026-09-12T00:00:00.000Z') }), {
		answers: [],
	});

	expect(embed.description).toContain('lifted somewhere other than here');
	// `GUILD_BAN_REMOVE` carries no actor, so the card must not imply one: the appellant is the only account
	// this description may ever mention.
	expect(embed.description?.match(/<@\d+>/g)).toStrictEqual(['<@2>']);
	expect(embed.description).not.toContain('a moderator');
	expect(embed.footer?.text).toBe('Appeal 12 | Closed, the ban was lifted');
});

test('a silent denial says so unmistakably, and says not to contact them', () => {
	const embed = buildAppealEmbed(
		makeAppeal({
			status: 'DENIED',
			silent: true,
			decidedAt: new Date('2026-09-12T00:00:00.000Z'),
			decidedById: '555',
			decisionReason: 'ban evasion, obviously',
		}),
		{ answers: [] },
	);

	// The whole hazard of decision 6 is a second moderator helpfully following up and blowing it, so this is the
	// one string on the card worth pinning.
	expect(embed.description).toContain('Silently');
	expect(embed.description).toContain('Do not contact them');
	expect(embed.description).toContain('<@555>');
});

test('an ordinary denial names the moderator and carries the reason, without the silent warning', () => {
	const embed = buildAppealEmbed(
		makeAppeal({
			status: 'DENIED',
			decidedAt: new Date('2026-09-12T00:00:00.000Z'),
			decidedById: '555',
			decisionReason: 'not this time',
		}),
		{ answers: [] },
	);

	expect(embed.description).toContain('Denied by <@555>');
	expect(embed.description).toContain('not this time');
	expect(embed.description).not.toContain('Do not contact them');
});

test('a withdrawal is the appellant own action, so no moderator is named', () => {
	const embed = buildAppealEmbed(makeAppeal({ status: 'WITHDRAWN', decidedAt: new Date('2026-09-12T00:00:00.000Z') }), {
		answers: [],
	});

	expect(embed.description).toContain('Withdrawn by the appellant');
	expect(embed.description).not.toContain('a moderator');
});

test('a pending card says nothing about a decision', () => {
	const embed = buildAppealEmbed(makeAppeal(), { answers: [] });

	expect(embed.description).not.toContain('Denied');
	expect(embed.description).not.toContain('Approved');
	expect(embed.footer?.text).toBe('Appeal 12 | Awaiting a decision');
});

test('answers render in position order, under the prompt they were given', () => {
	const embed = buildAppealEmbed(makeAppeal(), {
		answers: [
			makeAnswer({ position: 1, promptSnapshot: 'second', answer: 'b' }),
			makeAnswer({ position: 0, promptSnapshot: 'first', answer: 'a' }),
		],
	});

	expect(embed.fields?.map((field) => field.name)).toStrictEqual(['first', 'second']);
	expect(embed.fields?.[0]?.value).toContain('a');
});

test('an unanswered optional question renders as blank rather than disappearing', () => {
	// "They declined to answer this" is information a moderator wants, which is why the submit path writes empty
	// answers rather than skipping them.
	const embed = buildAppealEmbed(makeAppeal(), { answers: [makeAnswer({ answer: '   ' })] });

	expect(embed.fields).toHaveLength(1);
	expect(embed.fields?.[0]?.value).toBe('*They left this blank.*');
});

test('an appellant cannot close the code fence around their own answer', () => {
	const embed = buildAppealEmbed(makeAppeal(), {
		answers: [makeAnswer({ answer: '```\n**verified by staff**' })],
	});

	const value = embed.fields![0]!.value;
	expect(value.startsWith('```\n')).toBe(true);
	expect(value.endsWith('\n```')).toBe(true);
	// Three consecutive backticks anywhere inside would end the block early and let the rest render as markdown
	// in the bot's own embed.
	expect(value.slice(4, -4)).not.toContain('```');
});

test('a maximum-length answer still fits the embed field value cap', () => {
	const embed = buildAppealEmbed(makeAppeal(), {
		answers: [makeAnswer({ answer: 'x'.repeat(APPEAL_ANSWER_MAX_LENGTH) })],
	});

	expect(embed.fields![0]!.value.length).toBeLessThanOrEqual(APPEAL_ANSWER_MAX_LENGTH);
});

test('a maximum-length answer made of code fences still fits, and still cannot close the block', () => {
	// The all-`x` case above cannot catch this: neutralizing a fence *grows* the string, so an answer at the cap
	// that is nothing but backticks comes out a third longer than its limit. `unban.app` is a public form for
	// hostile users by construction, and the whole message 400s if this is wrong.
	const embed = buildAppealEmbed(makeAppeal(), {
		answers: [makeAnswer({ answer: '```'.repeat(Math.ceil(APPEAL_ANSWER_MAX_LENGTH / 3)) })],
	});

	const value = embed.fields![0]!.value;
	expect(value.length).toBeLessThanOrEqual(APPEAL_ANSWER_MAX_LENGTH);
	expect(value.slice(4, -4)).not.toContain('```');
});

test('a ban with no recorded reason says so instead of rendering an empty block', () => {
	const embed = buildAppealEmbed(makeAppeal({ reasonSnapshot: null }), { answers: [] });

	expect(embed.description).toContain('no reason recorded');
});

test('the thread name stays inside the 100 character cap', () => {
	expect(buildAppealThreadName(makeAppeal(), 'a'.repeat(200))).toHaveLength(100);
	expect(buildAppealThreadName(makeAppeal(), 'appellant')).toBe('Appeal 12 - appellant');
	expect(buildAppealThreadName(makeAppeal())).toBe('Appeal 12 - 2');
});
