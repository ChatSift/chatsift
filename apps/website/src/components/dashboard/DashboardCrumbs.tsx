'use client';

import type { BotId } from '@chatsift/core';
import { useParams, usePathname } from 'next/navigation';
import { useMemo } from 'react';
import type { AMASessionDetailed, AMASessionWithCount } from '@/api/routes/ama';
import { useMe } from '@/api/routes/auth';
import type { GuildChannelInfo } from '@/api/routes/guilds';
import type { ModmailCategory, ModmailPanel, ModmailSnippet } from '@/api/routes/modmail';
import type { BreadcrumbOption } from '@/components/common/Breadcrumb';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { Skeleton } from '@/components/common/Skeleton';
import { SvgAMA } from '@/components/icons/SvgAMA';
import { SvgModmail } from '@/components/icons/SvgModmail';
import type { BotBrandingSource } from '@/utils/bots';
import { BotIcon, resolveBotBranding } from '@/utils/bots';
import { sortGuilds } from '@/utils/util';

const NO_CUSTOM_INSTANCE: BotBrandingSource = {
	customInstanceIconUrl: null,
	customInstanceId: null,
	customInstanceLabel: null,
};

const MODMAIL_SECTIONS = ['config', 'categories', 'panels', 'snippets', 'blocks', 'threads'] as const;

const SEGMENT_LABELS: Record<string, string> = {
	ama: 'AMA',
	amas: 'Sessions',
	new: 'New',
	modmail: 'ModMail Bot',
	config: 'Config',
	categories: 'Categories',
	panels: 'Panels',
	snippets: 'Snippets',
	blocks: 'Blocks',
	threads: 'Threads',
	settings: 'Settings',
	questions: 'Questions',
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
	/**
	 * The current guild's custom-instance fields (#216), used to brand the `modmail` segment's own label/icon and
	 * its bot-switcher options when a custom instance owns the guild.
	 */
	guildBranding?: BotBrandingSource | undefined;
	modmailCategories?: ModmailCategory[] | undefined;
	modmailChannels?: GuildChannelInfo[] | undefined;
	modmailPanels?: ModmailPanel[] | undefined;
	modmailSnippets?: ModmailSnippet[] | undefined;
}

type SegmentOptions = { icon?: React.ReactNode; label?: React.ReactNode; options: readonly BreadcrumbOption[] } | null;

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
	const branding = data.guildBranding ?? NO_CUSTOM_INSTANCE;

	const options: BreadcrumbOption[] = (data.guildBots ?? [])
		.filter((bot) => bot !== currentBot)
		.map((bot) => {
			const botBranding = resolveBotBranding(branding, bot);
			return {
				label: botBranding.label,
				href: `/dashboard/${context.guildId}/${bot.toLowerCase()}`,
				reactIcon: <BotIcon bot={bot} branding={botBranding} height={20} width={20} />,
			};
		});

	// Only MODMAIL can be a custom instance (#216) -- for every other case (including a guild with no custom
	// instance at all) the static SEGMENT_LABELS/SEGMENT_ICONS fallback is already correct, so there's nothing to
	// override and the previous behaviour (no crumb dropdown when there's nothing to switch to) stays intact.
	const isCustomModmail = currentBot === 'MODMAIL' && branding.customInstanceId !== null;
	if (!isCustomModmail) {
		return options.length ? { options } : null;
	}

	const currentBranding = resolveBotBranding(branding, currentBot);
	return {
		options,
		icon: <BotIcon bot={currentBot} branding={currentBranding} height={20} width={20} />,
		label: currentBranding.label,
	};
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

// Deliberately no "New AMA" shortcut here (#303) -- you're already looking at an active AMA's breadcrumb,
// so switching to creating a brand new one reads as a stray/confusing option rather than a useful shortcut.
function amaIdOptions(amaId: string, context: SegmentContext, data: SegmentOptionsData): SegmentOptions {
	const options: BreadcrumbOption[] = (data.amaSessions ?? [])
		.filter((s) => s.id !== Number(amaId))
		.map((s) => ({ label: s.title, href: `/dashboard/${context.guildId}/ama/amas/${s.id}` }));

	return options.length ? { options } : null;
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

function resolveModmailCategoryLabel(categoryId: string, data: SegmentOptionsData): React.ReactNode {
	if (data.modmailCategories === undefined) {
		return <Skeleton className="h-5 w-32 inline-flex align-middle" />;
	}

	const category = data.modmailCategories.find((c) => c.id === Number(categoryId));
	return category?.name ?? categoryId;
}

function resolveModmailSnippetLabel(snippetId: string, data: SegmentOptionsData): React.ReactNode {
	if (data.modmailSnippets === undefined) {
		return <Skeleton className="h-5 w-32 inline-flex align-middle" />;
	}

	const snippet = data.modmailSnippets.find((s) => s.id === Number(snippetId));
	return snippet ? `/${snippet.name}` : snippetId;
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
	{
		pattern: ['modmail', 'categories', ':id'],
		resolveLabel: resolveModmailCategoryLabel,
	},
	{
		pattern: ['modmail', 'snippets', ':id'],
		resolveLabel: resolveModmailSnippetLabel,
	},
	{
		// Threads have no name field to resolve against (unlike panels/categories/snippets above), so this
		// just formats the raw id -- see #261's own doc for why.
		pattern: ['modmail', 'threads', ':id'],
		resolveLabel: (threadId) => `Thread #${threadId}`,
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

	const guild = me?.guilds.find((g) => g.id === params.id);

	// Merge in `guild.bots` so the `ama`/`modmail` segment's dropdown (see `SEGMENT_DEFINITIONS` above) can build
	// its options without a separate data fetch -- `useMe()` already has this.
	const effectiveSegmentOptionsData: SegmentOptionsData = useMemo(
		() => ({ ...segmentOptionsData, guildBots: guild?.bots, guildBranding: guild }),
		[segmentOptionsData, guild],
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

			const computedOptions = match?.definition.resolveOptions?.(match.id ?? '', context, effectiveSegmentOptionsData);

			const fallbackLabel = SEGMENT_LABELS[part] ?? part;
			const label: React.ReactNode =
				match?.id === undefined || match.id === null
					? (computedOptions?.label ?? fallbackLabel)
					: (match.definition.resolveLabel?.(match.id, effectiveSegmentOptionsData) ?? fallbackLabel);
			const icon = SEGMENT_ICONS[part];

			// Don't create an href for the last segment (current page).
			const isLastSegment = i === relevantParts.length - 1;

			if (isLastSegment) {
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
	}, [params.id, pathname, effectiveSegmentOptionsData]);

	if (!params.id) {
		throw new Error('id param not found, should not be rendering this component');
	}

	if (!guild) {
		throw new Error('guild not found, should not be rendering this component');
	}

	// Create dropdown options for other guilds with bots -- naturally empty under a `/dashboard`-minted scoped
	// session, since `fetchMeForScopedSession` only ever returns the single guild the session is scoped to.
	const guildOptions = sortGuilds(me?.guilds.filter((g) => g.id !== guild.id && g.bots.length > 0) ?? []).map((g) => ({
		label: g.name,
		href: `/dashboard/${g.id}`,
		icon: g.icon,
		id: g.id,
	}));

	return (
		<Breadcrumb
			segments={[
				{ label: 'Servers', href: '/dashboard' },
				{
					label: guild.name,
					href: segments.length === 0 ? undefined : `/dashboard/${guild.id}`,
					options: guildOptions,
				},
				...segments,
			]}
		/>
	);
}
