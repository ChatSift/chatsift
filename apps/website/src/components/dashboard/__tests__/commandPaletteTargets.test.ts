import { expect, test } from 'vitest';
import {
	amaSessionTargets,
	botSectionTargets,
	numberJumpKinds,
	numberJumps,
	otherGuildTargets,
	uniqueValues,
} from '../commandPaletteTargets';
import type { AMASessionWithCount } from '@/api/routes/ama';
import type { MeGuild } from '@/api/routes/auth';

function guild(overrides: Partial<MeGuild> = {}): MeGuild {
	return {
		id: '100',
		name: 'Nightshade Collective',
		icon: null,
		meCanManage: true,
		bots: ['AMA', 'MODMAIL', 'AUTOMODERATOR'],
		amaGuestSessionIds: [],
		experiments: [],
		customInstanceId: null,
		customInstanceLabel: null,
		customInstanceIconUrl: null,
		...overrides,
	};
}

test('a manager gets one group per bot, in the order the nav shows them, each opening with the hub', () => {
	const groups = botSectionTargets(guild(), { canManage: true, isAmaGuestOnly: false });

	expect(groups.map((group) => group.bot)).toStrictEqual(['AMA', 'MODMAIL', 'AUTOMODERATOR']);
	expect(groups[1]!.targets[0]).toStrictEqual({
		bot: 'MODMAIL',
		segment: null,
		title: 'Overview',
		href: '/dashboard/100/modmail',
	});
	expect(groups[1]!.targets.map((target) => target.segment)).toStrictEqual([
		null,
		'config',
		'categories',
		'panels',
		'snippets',
		'blocks',
		'threads',
	]);
	// The hub plus every section `automoderatorSections.ts` groups.
	expect(groups[2]!.targets).toHaveLength(15);
});

// Mirrors `GuildNav`: a guest's only tab is AMA, and it points at the sessions list rather than the hub
// `NavGateCheck` would bounce them off.
test('an AMA guest gets AMA sessions and nothing else', () => {
	const groups = botSectionTargets(guild({ meCanManage: false, amaGuestSessionIds: [3] }), {
		canManage: false,
		isAmaGuestOnly: true,
	});

	expect(groups).toStrictEqual([
		{ bot: 'AMA', targets: [{ bot: 'AMA', segment: 'amas', title: 'Sessions', href: '/dashboard/100/ama/amas' }] },
	]);
});

test('no access means no sections', () => {
	expect(botSectionTargets(guild({ meCanManage: false }), { canManage: false, isAmaGuestOnly: false })).toStrictEqual(
		[],
	);
});

test('a number with a word jumps to that one kind, with or without a hash', () => {
	const current = guild();

	expect(numberJumps('case 42', current)).toStrictEqual([
		{ bot: 'AUTOMODERATOR', label: 'Case #42', href: '/dashboard/100/automoderator/cases/42' },
	]);
	expect(numberJumps('Report #7', current).map((jump) => jump.href)).toStrictEqual([
		'/dashboard/100/automoderator/reports/7',
	]);
	expect(numberJumps('thread12', current).map((jump) => jump.href)).toStrictEqual([
		'/dashboard/100/modmail/threads/12',
	]);
	expect(numberJumps('  threads 3 ', current).map((jump) => jump.href)).toStrictEqual([
		'/dashboard/100/modmail/threads/3',
	]);
});

// Nobody should have to know the words first: a bare number lists every kind the guild has, in a fixed order.
test('a bare number offers every kind the guild has', () => {
	expect(numberJumps('42', guild()).map((jump) => jump.label)).toStrictEqual(['Case #42', 'Report #42', 'Thread #42']);
	expect(numberJumps('#9', guild({ bots: ['MODMAIL'] })).map((jump) => jump.href)).toStrictEqual([
		'/dashboard/100/modmail/threads/9',
	]);
});

// AMA sessions are listed by title instead (`amaSessionTargets`), so their number is not a jump.
test('a bare word, trailing text, a bot the guild lacks, or an AMA is not a jump', () => {
	expect(numberJumps('case', guild())).toStrictEqual([]);
	expect(numberJumps('case 42 please', guild())).toStrictEqual([]);
	expect(numberJumps('thread 5', guild({ bots: ['AMA'] }))).toStrictEqual([]);
	expect(numberJumps('ama 3', guild())).toStrictEqual([]);
	expect(numberJumps('3', guild({ bots: ['AMA'] }))).toStrictEqual([]);
});

test('the kinds on offer follow the bots the guild has', () => {
	expect(numberJumpKinds(guild({ bots: ['AMA', 'MODMAIL'] })).map((kind) => kind.kind)).toStrictEqual(['thread']);
	expect(numberJumpKinds(guild({ bots: ['SOCIAL'] }))).toStrictEqual([]);
});

test('AMA sessions list open ones first, newest first within each half', () => {
	const session = (id: number, title: string, ended: boolean): AMASessionWithCount =>
		({ id, title, ended }) as AMASessionWithCount;
	const targets = amaSessionTargets(guild(), [
		session(5, 'Modding 101', true),
		session(4, 'Launch Q&A', false),
		session(3, 'Roadmap', true),
		session(2, 'Meet the team', false),
	]);

	expect(targets.map((target) => target.title)).toStrictEqual([
		'Launch Q&A',
		'Meet the team',
		'Modding 101',
		'Roadmap',
	]);
	expect(targets[0]).toStrictEqual({ id: 4, title: 'Launch Q&A', ended: false, href: '/dashboard/100/ama/amas/4' });
});

test('other servers exclude the current one and any without a bot, sorted like the server list', () => {
	const guilds = [
		guild({ id: '1', name: 'Zeta', bots: ['AMA'] }),
		guild({ id: '2', name: 'Alpha', bots: ['AMA'] }),
		guild({ id: '3', name: 'Empty', bots: [] }),
		guild({ id: '4', name: 'Busy', bots: ['AMA', 'MODMAIL'] }),
	];

	expect(otherGuildTargets(guilds, '1').map((candidate) => candidate.name)).toStrictEqual(['Busy', 'Alpha']);
});

test('duplicate names get a counter so cmdk can tell the rows apart', () => {
	expect(uniqueValues(['Home', 'Home', 'Away', 'Home'])).toStrictEqual(['Home', 'Home (2)', 'Away', 'Home (3)']);
});
