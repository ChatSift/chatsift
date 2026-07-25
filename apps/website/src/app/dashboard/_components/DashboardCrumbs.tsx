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
} as const;

const SEGMENT_ICONS: Record<string, React.ReactNode> = {
	ama: <SvgAMA height={20} width={20} />,
	amas: (
		<div className="flex h-5 w-5 items-center justify-center rounded bg-misc-accent text-xs font-bold text-primary-dark">
			Q
		</div>
	),
	modmail: <SvgModmail height={20} width={20} />,
} as const;

interface SegmentOptionsContext {
	guildId: string;
	/**
	 * The full pathname
	 */
	pathname: string;
	/**
	 * The path segments leading up to and including the current segment
	 */
	segmentPath: readonly string[];
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

type SegmentOptionsComputer = (
	context: SegmentOptionsContext,
	data: SegmentOptionsData,
) => { icon?: React.ReactNode; options: readonly BreadcrumbOption[] } | null;

type SegmentOptionsMatcher = (segmentPath: readonly string[]) => boolean;

interface SegmentOptionsEntry {
	computer: SegmentOptionsComputer;
	matcher: SegmentOptionsMatcher | string;
}

/**
 * Segment options are keyed by the full path to the segment (joined by '/').
 * This allows for context-specific options without conflicts.
 * Example: 'ama/amas/new' will only match when the path is exactly [guild]/ama/amas/new
 * Matchers can also be functions for dynamic matching (e.g., numeric IDs)
 */
const SEGMENT_OPTIONS: SegmentOptionsEntry[] = [
	{
		// Match the top-level bot segment (`ama` or `modmail`) so it can offer a shortcut to whatever other
		// bots are invited to this guild, mirroring the guild-switch dropdown one level up.
		matcher: (segmentPath) => segmentPath.length === 1 && (segmentPath[0] === 'ama' || segmentPath[0] === 'modmail'),
		computer: (context, data) => {
			const currentBot: BotId = context.segmentPath[0] === 'ama' ? 'AMA' : 'MODMAIL';
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

			if (!options.length) {
				return null;
			}

			return { options };
		},
	},
	{
		// Match a ModMail sub-section (`config`, `categories`, `panels`, `snippets`, `blocks`) so it can offer
		// a shortcut to the other sections, instead of forcing a trip back through the ModMail nav tabs.
		matcher: (segmentPath) =>
			segmentPath.length === 2 &&
			segmentPath[0] === 'modmail' &&
			(MODMAIL_SECTIONS as readonly string[]).includes(segmentPath[1]!),
		computer: (context) => {
			const currentSection = context.segmentPath[1];
			const options: BreadcrumbOption[] = MODMAIL_SECTIONS.filter((section) => section !== currentSection).map(
				(section) => ({
					label: SEGMENT_LABELS[section] ?? section,
					href: `/dashboard/${context.guildId}/modmail/${section}`,
				}),
			);

			return { options };
		},
	},
	{
		matcher: 'ama/amas/new',
		computer: (context, data) => {
			// Only show dropdown if we have sessions
			if (!data.amaSessions?.length) {
				return null;
			}

			const options: BreadcrumbOption[] = data.amaSessions.map((s) => ({
				label: s.title,
				href: `/dashboard/${context.guildId}/ama/amas/${s.id}`,
			}));

			return {
				options,
			};
		},
	},
	{
		// Match ama/amas/[numeric id]
		matcher: (segmentPath) => {
			if (segmentPath.length !== 3) return false;
			if (segmentPath[0] !== 'ama') return false;
			if (segmentPath[1] !== 'amas') return false;
			return !Number.isNaN(Number(segmentPath[2]));
		},
		computer: (context, data) => {
			// Get current AMA ID from the path
			const currentAmaId = Number(context.segmentPath[2]);

			// Build options with "New" first, then existing AMAs (excluding current)
			const options: BreadcrumbOption[] = [
				{
					label: 'New AMA',
					href: `/dashboard/${context.guildId}/ama/amas/new`,
				},
				...(data.amaSessions ?? [])
					.filter((s) => s.id !== currentAmaId)
					.map((s) => ({
						label: s.title,
						href: `/dashboard/${context.guildId}/ama/amas/${s.id}`,
					})),
			];

			return {
				options,
			};
		},
	},
];

interface DashboardCrumbsProps {
	readonly segmentOptionsData?: SegmentOptionsData;
}

export function DashboardCrumbs({ segmentOptionsData }: DashboardCrumbsProps = {}) {
	const { data: me } = useMe();
	const params = useParams<{ id?: string }>();
	const pathname = usePathname();
	const grant = useGrantAuth();

	if (!params.id) {
		throw new Error('id param not found, should not be rendering this component');
	}

	const guild = me?.guilds.find((g) => g.id === params.id);

	// Merge in `guild.bots` so the `ama`/`modmail` segment's dropdown computer (see `SEGMENT_OPTIONS` above) can
	// build its options without a separate data fetch -- `useMe()` already has this.
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

		// Build segments with proper hrefs
		const result = [];
		for (let i = 0; i < relevantParts.length; i++) {
			const part = relevantParts[i];
			if (!part) {
				continue;
			}

			// Build the segment path up to this point for option matching
			const segmentPath = relevantParts.slice(0, i + 1);
			const segmentKey = segmentPath.join('/');

			// Find matching segment options entry
			const optionsEntry = SEGMENT_OPTIONS.find((entry) => {
				if (typeof entry.matcher === 'string') {
					return entry.matcher === segmentKey;
				}

				return entry.matcher(segmentPath);
			});

			// Determine the label
			let label: React.ReactNode = SEGMENT_LABELS[part] ?? part;
			const icon = SEGMENT_ICONS[part];

			// For AMA IDs, use the AMA title if available, or show skeleton while loading
			if (
				segmentPath.length === 3 &&
				segmentPath[0] === 'ama' &&
				segmentPath[1] === 'amas' &&
				!Number.isNaN(Number(part))
			) {
				const amaId = Number(part);

				// If we have currentAMA data and it matches, use it immediately
				if (effectiveSegmentOptionsData.currentAMA?.id === amaId) {
					label = effectiveSegmentOptionsData.currentAMA.title;
				} else if (effectiveSegmentOptionsData.currentAMA === undefined) {
					// If currentAMA is still loading, show skeleton
					label = <Skeleton className="h-5 w-32 inline-flex align-middle" />;
				} else {
					// currentAMA is loaded but doesn't match, try to find the AMA in sessions list
					const ama = effectiveSegmentOptionsData.amaSessions?.find((s) => s.id === amaId);
					// If found, use title; otherwise fall back to the ID
					label = ama ? ama.title : part;
				}
			}

			// For ModMail ticket panel IDs, use the panel's channel name (e.g. "#general") instead of
			// the raw numeric id -- there's no title field to fall back on the way AMA sessions have one.
			if (
				segmentPath.length === 3 &&
				segmentPath[0] === 'modmail' &&
				segmentPath[1] === 'panels' &&
				!Number.isNaN(Number(part))
			) {
				const panelId = Number(part);

				if (
					effectiveSegmentOptionsData.modmailPanels === undefined ||
					effectiveSegmentOptionsData.modmailChannels === undefined
				) {
					label = <Skeleton className="h-5 w-32 inline-flex align-middle" />;
				} else {
					const panel = effectiveSegmentOptionsData.modmailPanels.find((p) => p.id === panelId);
					const channel = panel && effectiveSegmentOptionsData.modmailChannels.find((c) => c.id === panel.channelId);
					label = channel ? `#${channel.name}` : (panel?.channelId ?? part);
				}
			}

			// While a one-time grant token is active, every other segment/dropdown option here would 401 (the
			// grant only authorizes the single page it links to) -- never compute a navigable option in that case.
			const computedOptions = grant
				? null
				: optionsEntry?.computer({ guildId: params.id, pathname, segmentPath }, effectiveSegmentOptionsData);

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
