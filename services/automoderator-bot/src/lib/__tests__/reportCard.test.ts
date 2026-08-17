import type { AutomoderatorReports, AutomoderatorReportState } from '@chatsift/db';
import type { APIButtonComponent } from '@discordjs/core';
import { ButtonStyle, ComponentType } from '@discordjs/core';
import { expect, test, vi } from 'vitest';

// Stubbed for the same reason `dryRun.test.ts` stubs it: `backend-core` parses its env schema at import time,
// which throws in a unit test. Nothing under test here touches the context -- the card is derived purely from
// the row -- so the stub only has to exist.
vi.mock('@chatsift/backend-core', () => ({
	ENV: { IS_PRODUCTION: false },
	getContext: () => ({ service: { client: { api: {} } } }),
	publishRealtimeInvalidate: async () => undefined,
}));

const { buildReportComponents, buildReportEmbed } = await import('../reportCard.js');

function makeReport(overrides: Partial<AutomoderatorReports> = {}): AutomoderatorReports {
	return {
		id: 7 as AutomoderatorReports['id'],
		guildId: '1',
		targetId: '2',
		targetTag: 'target',
		origin: 'GUILD' as AutomoderatorReports['origin'],
		messageId: '3',
		channelId: '4',
		messageContent: 'something rude',
		messageImageUrl: null,
		state: 'OPEN' as AutomoderatorReportState,
		resolvedBy: null,
		resolvedAt: null,
		caseId: null,
		cardChannelId: null,
		cardMessageId: null,
		createdAt: new Date('2026-08-17T00:00:00.000Z'),
		...overrides,
	};
}

function buttons(report: AutomoderatorReports): APIButtonComponent[] {
	const [row] = buildReportComponents(report);
	expect(row!.type).toBe(ComponentType.ActionRow);

	return (row as unknown as { components: APIButtonComponent[] }).components;
}

function byLabel(report: AutomoderatorReports, label: string): APIButtonComponent | undefined {
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
	// fails. `origin` is what decides, not the presence of a channel id -- which is why the column exists a phase
	// before anything writes `DM` to it.
	const dm = makeReport({ origin: 'DM' as AutomoderatorReports['origin'] });

	expect(buttons(dm).every((button) => button.style !== ButtonStyle.Link)).toBe(true);
	expect(buildReportEmbed(dm, { reporterCount: 1 }).description).not.toContain('<#4>');
	expect(byLabel(dm, 'Action')).toBeDefined();
});

test('a dismissed report offers Restore instead of Dismiss', () => {
	// The direction is read off the row, never off the label the last render happened to write -- which is the
	// bug this replaces.
	const dismissed = makeReport({ state: 'DISMISSED' as AutomoderatorReportState });

	expect(byLabel(dismissed, 'Dismiss')).toBeUndefined();
	expect(byLabel(dismissed, 'Restore')?.style).toBe(ButtonStyle.Danger);
	expect(byLabel(dismissed, 'Action')?.disabled).toBeFalsy();
});

test('an actioned report is closed for good', () => {
	// Actioning produced a case, and that case is the record now -- leaving the buttons live would offer a
	// second punishment for the same report.
	const actioned = makeReport({ state: 'ACTIONED' as AutomoderatorReportState, caseId: 12 });

	expect(byLabel(actioned, 'Dismiss')?.disabled).toBe(true);
	expect(byLabel(actioned, 'Action')?.disabled).toBe(true);
	expect(byLabel(actioned, 'View reporters')?.disabled).toBeFalsy();
});

test('the embed pluralizes the reporter count and names the state', () => {
	expect(buildReportEmbed(makeReport(), { reporterCount: 1 }).footer?.text).toBe('Report 7 | 1 reporter | Open');
	expect(buildReportEmbed(makeReport(), { reporterCount: 3 }).footer?.text).toBe('Report 7 | 3 reporters | Open');
	expect(
		buildReportEmbed(makeReport({ state: 'ACTIONED' as AutomoderatorReportState }), { reporterCount: 2 }).footer?.text,
	).toBe('Report 7 | 2 reporters | Actioned');
});

test('the embed says so when there was no text to quote', () => {
	const embed = buildReportEmbed(makeReport({ messageContent: null }), { reporterCount: 1 });
	expect(embed.description).toContain('no text content');

	const whitespace = buildReportEmbed(makeReport({ messageContent: '   ' }), { reporterCount: 1 });
	expect(whitespace.description).toContain('no text content');
});

test('a long message is truncated rather than dropped or left to overflow the embed', () => {
	// Discord rejects a description over 4096, and a message can be 4000 characters on its own before the
	// surrounding text -- so the cap has to bite well before that.
	const embed = buildReportEmbed(makeReport({ messageContent: 'a'.repeat(5_000) }), { reporterCount: 1 });

	expect(embed.description!.length).toBeLessThan(2_000);
	expect(embed.description).toContain('…');
});

test('a code fence in the reported text cannot break out of the quote block', () => {
	// Otherwise the reported account controls markdown inside the bot's own embed, and can dress its text up as
	// something the bot said -- a fake "verified" link being the obvious use.
	const embed = buildReportEmbed(makeReport({ messageContent: '```\nnot bot text\n```' }), { reporterCount: 1 });

	// Exactly the two fences this function opened and closed, and no more.
	expect(embed.description!.match(/(?<!`)```(?!`)/g)).toHaveLength(2);
	expect(embed.description).toContain('not bot text');
});

test('the dashboard link goes in the description, because a footer renders no markdown', () => {
	const link = 'https://example.com/dashboard/1/automoderator/reports/7';
	const embed = buildReportEmbed(makeReport(), { reporterCount: 1, dashboardLink: link });

	expect(embed.description).toContain(`(${link})`);
	expect(embed.footer?.text).not.toContain(link);

	// Omitted rather than rendered as a dead link when no link is supplied -- which is also what keeps this
	// function a pure function of the row.
	expect(buildReportEmbed(makeReport(), { reporterCount: 1 }).description).not.toContain('dashboard');
});

test('an image url becomes the embed image, which is what makes it outlive the signed url', () => {
	const url = 'https://cdn.discordapp.com/attachments/1/2/rude.png?ex=1&is=2&hm=3';
	const embed = buildReportEmbed(makeReport({ messageImageUrl: url }), { reporterCount: 1 });

	expect(embed.image?.url).toBe(url);
	expect(buildReportEmbed(makeReport(), { reporterCount: 1 }).image).toBeUndefined();
});
