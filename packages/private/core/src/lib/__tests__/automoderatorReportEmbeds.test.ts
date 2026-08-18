import type { APIButtonComponent } from 'discord-api-types/v10';
import { ButtonStyle, ComponentType } from 'discord-api-types/v10';
import { expect, test } from 'vitest';
import type { ReportContextMessageInput, ReportEmbedInput } from '../automoderatorReportEmbeds.js';
import { buildReportComponents, buildReportEmbeds } from '../automoderatorReportEmbeds.js';

function makeReport(overrides: Partial<ReportEmbedInput> = {}): ReportEmbedInput {
	return {
		id: 7,
		guildId: '1',
		targetId: '2',
		targetTag: 'target',
		origin: 'GUILD',
		messageId: '3',
		channelId: '4',
		messageContent: 'something rude',
		messageImageUrl: null,
		state: 'OPEN',
		createdAt: new Date('2026-08-17T00:00:00.000Z'),
		...overrides,
	};
}

function makeContext(overrides: Partial<ReportContextMessageInput> = {}): ReportContextMessageInput {
	return {
		messageId: '90',
		authorId: '2',
		authorTag: 'target',
		content: 'and again',
		imageUrl: null,
		...overrides,
	};
}

function subject(report: ReportEmbedInput, options: Parameters<typeof buildReportEmbeds>[1]) {
	return buildReportEmbeds(report, options)[0]!;
}

function buttons(report: ReportEmbedInput): APIButtonComponent[] {
	const [row] = buildReportComponents(report);
	expect(row!.type).toBe(ComponentType.ActionRow);

	return (row as unknown as { components: APIButtonComponent[] }).components;
}

function byLabel(report: ReportEmbedInput, label: string): APIButtonComponent | undefined {
	return buttons(report).find((button) => 'label' in button && button.label === label);
}

test('an open message report offers a jump link and both handled buttons', () => {
	const row = buttons(makeReport());

	const review = row[0]!;
	expect(review.style).toBe(ButtonStyle.Link);
	expect((review as { url: string }).url).toBe('https://discord.com/channels/1/4/3');

	expect(byLabel(makeReport(), 'Dismiss')?.disabled).toBeFalsy();
	expect(byLabel(makeReport(), 'Action')?.disabled).toBeFalsy();
	expect(byLabel(makeReport(), 'Restore')).toBeUndefined();
});

test('an account-level report has no jump link at all', () => {
	// Legacy shipped a permanently disabled placeholder button here. There is nothing to jump to, so the button
	// simply isn't rendered.
	const row = buttons(makeReport({ messageId: null, channelId: null }));

	expect(row.every((button) => button.style !== ButtonStyle.Link)).toBe(true);
	expect(byLabel(makeReport({ messageId: null, channelId: null }), 'Dismiss')).toBeDefined();
});

test('a DM-origin report gets no jump link even though it has a channel id', () => {
	// The channel id is a DM only its two participants can open, so a link there would be a button that always
	// fails. `origin` is what decides, not the presence of a channel id.
	const dm = makeReport({ origin: 'DM' });

	expect(buttons(dm).every((button) => button.style !== ButtonStyle.Link)).toBe(true);
	expect(subject(dm, { reporterCount: 1 }).description).not.toContain('<#4>');
	expect(byLabel(dm, 'Action')).toBeDefined();
});

test('a DM report says on the card that staff cannot see the conversation', () => {
	// The one thing that makes a DM report different in kind: there is no jump link to corroborate it against,
	// and a moderator who doesn't know that will read it as though there were.
	expect(subject(makeReport({ origin: 'DM' }), { reporterCount: 1 }).description).toContain('staff cannot see');

	// A guild report is corroborable, so it must not carry the disclaimer.
	expect(subject(makeReport(), { reporterCount: 1 }).description).not.toContain('staff cannot see');
});

test('a dismissed report offers Restore instead of Dismiss', () => {
	// The direction is read off the row, never off the label the last render happened to write -- which is the
	// bug this replaces.
	const dismissed = makeReport({ state: 'DISMISSED' });

	expect(byLabel(dismissed, 'Dismiss')).toBeUndefined();
	expect(byLabel(dismissed, 'Restore')?.style).toBe(ButtonStyle.Danger);
	expect(byLabel(dismissed, 'Action')?.disabled).toBeFalsy();
});

test('an actioned report is closed for good', () => {
	// Actioning produced a case, and that case is the record now -- leaving the buttons live would offer a
	// second punishment for the same report.
	const actioned = makeReport({ state: 'ACTIONED' });

	expect(byLabel(actioned, 'Dismiss')?.disabled).toBe(true);
	expect(byLabel(actioned, 'Action')?.disabled).toBe(true);
	expect(byLabel(actioned, 'View reporters')?.disabled).toBeFalsy();
});

test('the embed pluralizes the reporter count and names the state', () => {
	expect(subject(makeReport(), { reporterCount: 1 }).footer?.text).toBe('Report 7 | 1 reporter | Open');
	expect(subject(makeReport(), { reporterCount: 3 }).footer?.text).toBe('Report 7 | 3 reporters | Open');
	expect(subject(makeReport({ state: 'ACTIONED' }), { reporterCount: 2 }).footer?.text).toBe(
		'Report 7 | 2 reporters | Actioned',
	);
});

test('the embed says so when there was no text to quote', () => {
	expect(subject(makeReport({ messageContent: null }), { reporterCount: 1 }).description).toContain('no text content');
	expect(subject(makeReport({ messageContent: '   ' }), { reporterCount: 1 }).description).toContain('no text content');
});

test('a long message is truncated rather than dropped or left to overflow the embed', () => {
	// Discord rejects a description over 4096, and a message can be 4000 characters on its own before the
	// surrounding text -- so the cap has to bite well before that.
	const embed = subject(makeReport({ messageContent: 'a'.repeat(5_000) }), { reporterCount: 1 });

	expect(embed.description!.length).toBeLessThan(2_000);
	expect(embed.description).toContain('…');
});

test('a code fence in the reported text cannot break out of the quote block', () => {
	// Otherwise the reported account controls markdown inside the bot's own embed, and can dress its text up as
	// something the bot said -- a fake "verified" link being the obvious use.
	const embed = subject(makeReport({ messageContent: '```\nnot bot text\n```' }), { reporterCount: 1 });

	// Exactly the two fences this function opened and closed, and no more.
	expect(embed.description!.match(/(?<!`)```(?!`)/g)).toHaveLength(2);
	expect(embed.description).toContain('not bot text');
});

test('a code fence in a context message is neutralized the same way', () => {
	// Same vector, and the context messages are the half a reporter chooses -- so this is if anything the easier
	// one to plant.
	const [, context] = buildReportEmbeds(makeReport({ origin: 'DM' }), {
		reporterCount: 1,
		contextMessages: [makeContext({ content: '```\nnot bot text\n```' })],
	});

	expect(context!.description!.match(/(?<!`)```(?!`)/g)).toHaveLength(2);
});

test('the dashboard link goes in the description, because a footer renders no markdown', () => {
	const link = 'https://example.com/dashboard/1/automoderator/reports/7';
	const embed = subject(makeReport(), { reporterCount: 1, dashboardLink: link });

	expect(embed.description).toContain(`(${link})`);
	expect(embed.footer?.text).not.toContain(link);

	// Omitted rather than rendered as a dead link when no link is supplied -- which is also what keeps this
	// function a pure function of the row.
	expect(subject(makeReport(), { reporterCount: 1 }).description).not.toContain('dashboard');
});

test('an image url becomes the embed image, which is what makes it outlive the signed url', () => {
	const url = 'https://cdn.discordapp.com/attachments/1/2/rude.png?ex=1&is=2&hm=3';

	expect(subject(makeReport({ messageImageUrl: url }), { reporterCount: 1 }).image?.url).toBe(url);
	expect(subject(makeReport(), { reporterCount: 1 }).image).toBeUndefined();
});

test('context messages become their own embeds, in the order the reporter chose', () => {
	// One embed each rather than fields on the subject embed, because an embed holds exactly one image and each
	// captured message can have its own -- which is the only thing that outlives the CDN signature.
	const embeds = buildReportEmbeds(makeReport({ origin: 'DM' }), {
		reporterCount: 1,
		contextMessages: [
			makeContext({ messageId: '90', content: 'first' }),
			makeContext({ messageId: '91', content: 'second', imageUrl: 'https://cdn.discordapp.com/x.png' }),
		],
	});

	expect(embeds).toHaveLength(3);
	expect(embeds[1]!.description).toContain('first');
	expect(embeds[2]!.description).toContain('second');
	expect(embeds[2]!.image?.url).toBe('https://cdn.discordapp.com/x.png');
	expect(embeds[1]!.footer?.text).toBe('Context 1 of 2');
});

test('a context message written by the reporter is labelled as theirs', () => {
	// The whole reason these rows carry an author: a draft can include the reporter's own replies, and a
	// moderator reading them as the reported account's words would draw the opposite conclusion.
	const [, fromTarget, fromReporter] = buildReportEmbeds(makeReport({ origin: 'DM' }), {
		reporterCount: 1,
		reporterId: '55',
		contextMessages: [
			makeContext({ messageId: '90', authorId: '2', authorTag: 'target' }),
			makeContext({ messageId: '91', authorId: '55', authorTag: 'reporter' }),
		],
	});

	expect(fromTarget!.author?.name).toBe('target (reported account)');
	expect(fromReporter!.author?.name).toBe('reporter (reporter)');
});

test('a third participant is never labelled as the reporter', () => {
	// The context menu runs in `PRIVATE_CHANNEL`, which covers group DMs, so a draft can capture somebody who
	// is neither the target nor the reporter. Calling them the reporter would tell a moderator that the person
	// filing the report said something they never said -- which is worse than saying nothing.
	const [, third] = buildReportEmbeds(makeReport({ origin: 'DM' }), {
		reporterCount: 1,
		reporterId: '55',
		contextMessages: [makeContext({ messageId: '92', authorId: '999', authorTag: 'bystander' })],
	});

	expect(third!.author?.name).toBe('bystander (other participant)');
});

test('with no reporter id, everyone who is not the target is labelled neutrally', () => {
	// Guessing would be worse than a neutral label: the card is what staff act on.
	const [, unknown] = buildReportEmbeds(makeReport({ origin: 'DM' }), {
		reporterCount: 1,
		contextMessages: [makeContext({ messageId: '93', authorId: '55', authorTag: 'reporter' })],
	});

	expect(unknown!.author?.name).toBe('reporter (other participant)');
});

test('a guild report renders exactly one embed', () => {
	expect(buildReportEmbeds(makeReport(), { reporterCount: 1 })).toHaveLength(1);
});
