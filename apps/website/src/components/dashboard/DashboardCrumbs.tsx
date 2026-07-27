'use client';

import type { BotId } from '@chatsift/core';
import { useParams, usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { useGrantAuth } from '@/api/grant';
import type { AMASessionDetailed, AMASessionWithCount } from '@/api/routes/ama';
import { useMe } from '@/api/routes/auth';
import type { GuildChannelInfo } from '@/api/routes/guilds';
import type { ModmailPanel } from '@/api/routes/modmail';
import type { BreadcrumbOption } from '@/components/common/Breadcrumb';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { GuildIcon } from '@/components/common/GuildIcon';
import { Skeleton } from '@/components/common/Skeleton';
import { SvgAMA } from '@/components/icons/SvgAMA';
import { SvgModmail } from '@/components/icons/SvgModmail';
import { Bots } from '@/utils/bots';
import { sortGuilds } from '@/utils/util';

const MODMAIL_SECTIONS = ['config', 'categories', 'panels', 'snippets', 'blocks'] as const;

const SEGMENT_LABELS: Record<string, string> = {
	ama: 'AMA Bot',
	amas: 'AMA Sessions',
	new: 'New',
	modmail: 'ModMail Bot',
	config: 'Config',
	categories: 'Categories',
	panels: 'Panels',
	snippets: 'Snippets',
	blocks: 'Blocks',
	settings: 'Settings',
} as const;

const SEGMENT_ICONS: Record<string, React.ReactNode> = {
	ama: <SvgAMA height={20} width={20} />,
	modmail: <SvgModmail height={20} width={20} />,
} as const;

interface SegmentContext {
	guildId: string;
}

export interface SegmentOptionsData {
	amaSessions?: AMASessionWithCount[] | undefined;
	currentAMA?: AMASessionDetailed | undefined;
	/**
	 * Bots invited to the current guild, used to build the bot-switcher dropdown on the `ama`/`modmail` segment.
	 */
	guildBots?: readonly BotId[] | undefined;
	modmailChannels?: GuildChannelInfo[] | undefined;
	modmailPanels?: ModmailPanel[] | undefined;
}

type SegmentOptions = { icon?: React.ReactNode; options: readonly BreadcrumbOption[] } | null;

/**
 * One path segment of a pattern, matched literally against the raw URL segment -- except `:id`, which matches
 * any segment that parses as a number (and is then passed to the definition's resolvers).
 */
type PatternToken = string;

interface SegmentDefinition {
	readonly pattern: readonly PatternToken[];
	resolveLabel?(id: string, data: SegmentOptionsData): React.ReactNode;
	resolveOptions?(id: string, context: SegmentContext, data: SegmentOptionsData): SegmentOptions;
}

function botSwitcherOptions(currentBot: BotId, context: SegmentContext, data: SegmentOptionsData): SegmentOptions {
	const options: BreadcrumbOption[] = (data.guildBots ?? [])
		.filter((bot) => bot !== currentBot)
		.map((bot) => {
			const { Icon, label } = Bots[bot];
			return {
				label,
				href: `/dashboard/${context.guildId}/${bot.toLowerCase()}`,
				reactIcon: <Icon height={20} width={20} />,
			};
		});

	return options.length ? { options } : null;
}

function modmailSectionOptions(currentSection: string, context: SegmentContext): SegmentOptions {
	const options: BreadcrumbOption[] = MODMAIL_SECTIONS.filter((section) => section !== currentSection).map(
		(section) => ({
			label: SEGMENT_LABELS[section] ?? section,
			href: `/dashboard/${context.guildId}/modmail/${section}`,
		}),
	);

	return { options };
}

function resolveAmaLabel(amaId: string, data: SegmentOptionsData): React.ReactNode {
	// If we have currentAMA data and it matches, use it immediately
	if (data.currentAMA?.id === Number(amaId)) {
		return data.currentAMA.title;
	}

	// If currentAMA is still loading, show a skeleton
	if (data.currentAMA === undefined) {
		return <Skeleton className="h-5 w-32 inline-flex align-middle" />;
	}

	// currentAMA is loaded but doesn't match this segment; try the sessions list, else fall back to the raw id
	const ama = data.amaSessions?.find((s) => s.id === Number(amaId));
	return ama ? ama.title : amaId;
}

function amaIdOptions(amaId: string, context: SegmentContext, data: SegmentOptionsData): SegmentOptions {
	const options: BreadcrumbOption[] = [
		{ label: 'New AMA', href: `/dashboard/${context.guildId}/ama/amas/new` },
		...(data.amaSessions ?? [])
			.filter((s) => s.id !== Number(amaId))
			.map((s) => ({ label: s.title, href: `/dashboard/${context.guildId}/ama/amas/${s.id}` })),
	];

	return { options };
}

// ModMail ticket panels have no title field to fall back on the way AMA sessions do, so this resolves to the
// panel's channel name (e.g. "#general") instead of the raw numeric id.
function resolveModmailPanelLabel(panelId: string, data: SegmentOptionsData): React.ReactNode {
	if (data.modmailPanels === undefined || data.modmailChannels === undefined) {
		return <Skeleton className="h-5 w-32 inline-flex align-middle" />;
	}

	const panel = data.modmailPanels.find((p) => p.id === Number(panelId));
	const channel = panel && data.modmailChannels.find((c) => c.id === panel.channelId);
	return channel ? `#${channel.name}` : (panel?.channelId ?? panelId);
}

/**
 * Segment definitions are tried in order against the full path leading up to and including the segment being
 * rendered (e.g. `['modmail', 'panels', '42']`). The first pattern that matches wins. This is the single place
 * that maps a URL shape to breadcrumb behaviour beyond the plain `SEGMENT_LABELS`/`SEGMENT_ICONS` lookups.
 */
const SEGMENT_DEFINITIONS: readonly SegmentDefinition[] = [
	{
		// The top-level bot segment (`ama`/`modmail`) offers a shortcut to whatever other bots are invited to
		// this guild, mirroring the guild-switch dropdown one level up.
		pattern: ['ama'],
		resolveOptions: (_id, context, data) => botSwitcherOptions('AMA', context, data),
	},
	{
		pattern: ['modmail'],
		resolveOptions: (_id, context, data) => botSwitcherOptions('MODMAIL', context, data),
	},
	// Each ModMail sub-section offers a shortcut to the other sections, instead of forcing a trip back through
	// the ModMail nav tabs.
	...MODMAIL_SECTIONS.map((section): SegmentDefinition => ({
		pattern: ['modmail', section],
		resolveOptions: (_id, context) => modmailSectionOptions(section, context),
	})),
	{
		pattern: ['ama', 'amas', 'new'],
		resolveOptions: (_id, context, data) => {
			if (!data.amaSessions?.length) {
				return null;
			}

			const options: BreadcrumbOption[] = data.amaSessions.map((s) => ({
				label: s.title,
				href: `/dashboard/${context.guildId}/ama/amas/${s.id}`,
			}));
			return { options };
		},
	},
	{
		pattern: ['ama', 'amas', ':id'],
		resolveLabel: resolveAmaLabel,
		resolveOptions: amaIdOptions,
	},
	{
		pattern: ['modmail', 'panels', ':id'],
		resolveLabel: resolveModmailPanelLabel,
	},
];

/**
 * Matches `segmentPath` (the path leading up to and including the segment being rendered) against a definition's
 * pattern. Returns the value captured by a trailing `:id` token, if any, or `null` if there's no `:id` and the
 * pattern otherwise matches every literal segment exactly.
 */
function matchPattern(pattern: readonly PatternToken[], segmentPath: readonly string[]): string | null | undefined {
	if (pattern.length !== segmentPath.length) {
		return undefined;
	}

	let id: string | null = null;
	for (const [i, token] of pattern.entries()) {
		const part = segmentPath[i]!;
		if (token === ':id') {
			if (Number.isNaN(Number(part))) {
				return undefined;
			}

			id = part;
			continue;
		}

		if (token !== part) {
			return undefined;
		}
	}

	return id;
}

function findSegmentDefinition(
	segmentPath: readonly string[],
): { definition: SegmentDefinition; id: string | null } | undefined {
	for (const definition of SEGMENT_DEFINITIONS) {
		const id = matchPattern(definition.pattern, segmentPath);
		if (id !== undefined) {
			return { definition, id };
		}
	}

	return undefined;
}

interface DashboardCrumbsProps {
	readonly segmentOptionsData?: SegmentOptionsData;
}

export function DashboardCrumbs({ segmentOptionsData }: DashboardCrumbsProps = {}) {
	const { data: me } = useMe();
	const params = useParams<{ id?: string }>();
	const pathname = usePathname();
	const grant = useGrantAuth();

	const guild = me?.guilds.find((g) => g.id === params.id);

	// Merge in `guild.bots` so the `ama`/`modmail` segment's dropdown (see `SEGMENT_DEFINITIONS` above) can build
	// its options without a separate data fetch -- `useMe()` already has this.
	const effectiveSegmentOptionsData: SegmentOptionsData = useMemo(
		() => ({ ...segmentOptionsData, guildBots: guild?.bots }),
		[segmentOptionsData, guild?.bots],
	);

	const segments = useMemo(() => {
		if (!params.id || !pathname) {
			return [];
		}

		// Split the pathname and remove empty strings
		const pathParts = pathname.split('/').filter(Boolean);

		// Find where the guild ID is in the path
		const guildIdIndex = pathParts.indexOf(params.id);
		if (guildIdIndex === -1) {
			return [];
		}

		// Get all segments after the guild ID
		const relevantParts = pathParts.slice(guildIdIndex + 1);
		const context: SegmentContext = { guildId: params.id };

		const result = [];
		for (let i = 0; i < relevantParts.length; i++) {
			const part = relevantParts[i];
			if (!part) {
				continue;
			}

			const segmentPath = relevantParts.slice(0, i + 1);
			const match = findSegmentDefinition(segmentPath);

			const fallbackLabel = SEGMENT_LABELS[part] ?? part;
			const label: React.ReactNode =
				match?.id === undefined || match.id === null
					? fallbackLabel
					: (match.definition.resolveLabel?.(match.id, effectiveSegmentOptionsData) ?? fallbackLabel);
			const icon = SEGMENT_ICONS[part];

			// While a one-time grant token is active, every other segment/dropdown option here would 401 (the
			// grant only authorizes the single page it links to) -- never compute a navigable option in that case.
			const computedOptions = grant
				? null
				: match?.definition.resolveOptions?.(match.id ?? '', context, effectiveSegmentOptionsData);

			// Don't create an href for the last segment (current page), or for any segment while grant mode is
			// active (there's nowhere else on the dashboard a grant token lets you go).
			const isLastSegment = i === relevantParts.length - 1;

			if (isLastSegment || grant) {
				result.push({
					label,
					...(icon && { icon }),
					...(computedOptions?.icon && { icon: computedOptions.icon }),
					...(computedOptions && { options: computedOptions.options }),
				});
			} else {
				// Build the href up to this segment
				const pathUpToHere = pathParts.slice(0, guildIdIndex + 2 + i).join('/');
				result.push({
					label,
					href: `/${pathUpToHere}`,
					...(icon && { icon }),
					...(computedOptions?.icon && { icon: computedOptions.icon }),
					...(computedOptions && { options: computedOptions.options }),
				});
			}
		}

		return result;
	}, [params.id, pathname, effectiveSegmentOptionsData, grant]);

	if (!params.id) {
		throw new Error('id param not found, should not be rendering this component');
	}

	if (!guild) {
		throw new Error('guild not found, should not be rendering this component');
	}

	// Create dropdown options for other guilds with bots -- naturally empty under a grant token, since
	// `fetchMeFromGrant` only ever returns the single guild the grant is scoped to.
	const guildOptions = sortGuilds(me?.guilds.filter((g) => g.id !== guild.id && g.bots.length > 0) ?? []).map((g) => ({
		label: g.name,
		href: `/dashboard/${g.id}`,
		icon: g.icon,
		id: g.id,
	}));

	return (
		<Breadcrumb
			segments={[
				{ label: 'Servers', href: grant ? undefined : '/dashboard' },
				{
					label: guild.name,
					href: grant || segments.length === 0 ? undefined : `/dashboard/${guild.id}`,
					icon: <GuildIcon data={guild} disableLink hasBots />,
					options: guildOptions,
				},
				...segments,
			]}
		/>
	);
}
