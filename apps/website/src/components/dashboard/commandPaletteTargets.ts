import type { BotId } from '@chatsift/core';
import type { AMASessionWithCount } from '@/api/routes/ama';
import type { MeGuild } from '@/api/routes/auth';
import type { GuildAccess } from '@/hooks/useGuildAccess';
import { BOT_SECTIONS } from '@/utils/botSections';
import { sortGuilds } from '@/utils/util';

/**
 * What the jump-to palette can navigate to, worked out here without React so the access gating and the
 * number-jump grammar have tests. `CommandPalette.tsx` adds the labels, icons and cmdk plumbing.
 */

export interface SectionTarget {
	readonly bot: BotId;
	readonly href: string;
	/**
	 * `null` for the bot's hub page.
	 */
	readonly segment: string | null;
	readonly title: string;
}

export interface BotSectionGroup {
	readonly bot: BotId;
	readonly targets: readonly SectionTarget[];
}

/**
 * One group per bot the guild has, in `guild.bots` order (the same order `GuildNav` shows them in), each
 * opening with the hub and following with its sections. Scoped the way `GuildNav` and `NavGateCheck` scope
 * the nav: a manager sees every bot, an AMA guest sees AMA's sessions and nothing else -- not even the AMA
 * hub, which `NavGateCheck` would only bounce them off.
 */
export function botSectionTargets(
	guild: MeGuild,
	access: Pick<GuildAccess, 'canManage' | 'isAmaGuestOnly'>,
): BotSectionGroup[] {
	if (!access.canManage && !access.isAmaGuestOnly) {
		return [];
	}

	return guild.bots
		.filter((bot) => !access.isAmaGuestOnly || bot === 'AMA')
		.map((bot) => {
			const base = `/dashboard/${guild.id}/${bot.toLowerCase()}`;
			const sections = BOT_SECTIONS[bot].map((section): SectionTarget => ({
				bot,
				segment: section.segment,
				title: section.title,
				href: `${base}/${section.segment}`,
			}));

			return {
				bot,
				targets: access.isAmaGuestOnly
					? sections
					: [{ bot, segment: null, title: 'Overview', href: base }, ...sections],
			};
		});
}

/**
 * The other servers worth switching to: everything with a bot in it, sorted the way the server list is.
 * Naturally empty under a scoped session, which only ever lists the one guild it is scoped to.
 */
export function otherGuildTargets(guilds: readonly MeGuild[], currentGuildId: string | undefined): MeGuild[] {
	return sortGuilds(guilds.filter((guild) => guild.id !== currentGuildId && guild.bots.length > 0));
}

/**
 * cmdk keys its items by value, so two servers with the same name need telling apart -- the second and later
 * repeats get a counter. Labels are rendered separately and stay as they were.
 */
export function uniqueValues(labels: readonly string[]): string[] {
	const seen = new Map<string, number>();
	return labels.map((label) => {
		const count = (seen.get(label) ?? 0) + 1;
		seen.set(label, count);
		return count === 1 ? label : `${label} (${count})`;
	});
}

export interface NumberJumpKind {
	readonly bot: BotId;
	/**
	 * The word the grammar below accepts, and what selecting the kind's row in the palette types for you.
	 */
	readonly kind: string;
	readonly label: string;
}

export interface NumberJump {
	readonly bot: BotId;
	readonly href: string;
	readonly label: string;
}

// The pages whose URL is a number, in the words their breadcrumbs use. These are the lists too long to show
// (a busy server has thousands of cases); an AMA session's URL is a number too, but a server has few enough
// of them that `amaSessionTargets` below lists them by title instead.
const NUMBER_JUMP_KINDS: readonly (NumberJumpKind & { readonly path: string })[] = [
	{ kind: 'case', bot: 'AUTOMODERATOR', label: 'Case', path: 'automoderator/cases' },
	{ kind: 'report', bot: 'AUTOMODERATOR', label: 'Report', path: 'automoderator/reports' },
	{ kind: 'thread', bot: 'MODMAIL', label: 'Thread', path: 'modmail/threads' },
];

/**
 * The kinds of number this guild can jump to. The palette lists them as rows ("Case by number") so the
 * grammar is something you can see rather than something you have to know.
 */
export function numberJumpKinds(guild: MeGuild): NumberJumpKind[] {
	return NUMBER_JUMP_KINDS.filter((candidate) => guild.bots.includes(candidate.bot)).map(({ kind, bot, label }) => ({
		kind,
		bot,
		label,
	}));
}

// `42`, `#42`, `case 42`, `Report #7`, `thread12`. The word is optional: a bare number offers every kind the
// guild has, and picking one is how somebody learns the words exist.
const NUMBER_JUMP_PATTERN = /^\s*(?:(?<kind>case|report|thread)s?\s*)?#?\s*(?<id>\d+)\s*$/i;

export function numberJumps(query: string, guild: MeGuild): NumberJump[] {
	const groups = NUMBER_JUMP_PATTERN.exec(query)?.groups;
	if (!groups) {
		return [];
	}

	const kind = groups['kind']?.toLowerCase();
	const id = groups['id']!;
	return NUMBER_JUMP_KINDS.filter(
		(candidate) => (kind === undefined || candidate.kind === kind) && guild.bots.includes(candidate.bot),
	).map((candidate) => ({
		bot: candidate.bot,
		label: `${candidate.label} #${id}`,
		href: `/dashboard/${guild.id}/${candidate.path}/${id}`,
	}));
}

export interface AMASessionTarget {
	readonly ended: boolean;
	readonly href: string;
	readonly id: number;
	readonly title: string;
}

/**
 * A guild's AMA sessions, by title: the ones still taking questions first, newest first within each half.
 * The API already returns newest first, so this only has to pull the open ones forward.
 */
export function amaSessionTargets(guild: MeGuild, sessions: readonly AMASessionWithCount[]): AMASessionTarget[] {
	return sessions
		.map((session) => ({
			id: session.id,
			title: session.title,
			ended: session.ended,
			href: `/dashboard/${guild.id}/ama/amas/${session.id}`,
		}))
		.sort((a, b) => Number(a.ended) - Number(b.ended) || b.id - a.id);
}
