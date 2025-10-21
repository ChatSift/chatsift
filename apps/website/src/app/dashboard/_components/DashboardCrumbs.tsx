'use client';

import type { AMASessionDetailed, AMASessionWithCount } from '@chatsift/api';
import { useParams, usePathname } from 'next/navigation';
import { useMemo } from 'react';
import type { BreadcrumbOption } from '@/components/common/Breadcrumb';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { GuildIcon } from '@/components/common/GuildIcon';
import { Skeleton } from '@/components/common/Skeleton';
import { SvgAMA } from '@/components/icons/SvgAMA';
import { client } from '@/data/client';
import { sortGuilds } from '@/utils/util';

const SEGMENT_LABELS: Record<string, string> = {
	ama: 'AMA Bot',
	amas: 'AMA Sessions',
	new: 'New',
} as const;

const SEGMENT_ICONS: Record<string, React.ReactNode> = {
	ama: <SvgAMA height={20} width={20} />,
	amas: (
		<div className="flex h-5 w-5 items-center justify-center rounded bg-misc-accent text-xs font-bold text-primary-dark">
			Q
		</div>
	),
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
	const { data: me } = client.auth.useMe();
	const params = useParams<{ id?: string }>();
	const pathname = usePathname();

	if (!params.id) {
		throw new Error('id param not found, should not be rendering this component');
	}

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
				if (segmentOptionsData?.currentAMA?.id === amaId) {
					label = segmentOptionsData.currentAMA.title;
				} else if (segmentOptionsData?.currentAMA === undefined) {
					// If currentAMA is still loading, show skeleton
					label = <Skeleton className="h-5 w-32 inline-flex align-middle" />;
				} else {
					// currentAMA is loaded but doesn't match, try to find the AMA in sessions list
					const ama = segmentOptionsData?.amaSessions?.find((s) => s.id === amaId);
					// If found, use title; otherwise fall back to the ID
					label = ama ? ama.title : part;
				}
			}

			const computedOptions = optionsEntry?.computer(
				{ guildId: params.id, pathname, segmentPath },
				segmentOptionsData ?? {},
			);

			// Don't create an href for the last segment (current page)
			const isLastSegment = i === relevantParts.length - 1;

			if (isLastSegment) {
				result.push({
					label,
					...(icon && { icon }),
					...(computedOptions && { icon: computedOptions.icon, options: computedOptions.options }),
				});
			} else {
				// Build the href up to this segment
				const pathUpToHere = pathParts.slice(0, guildIdIndex + 2 + i).join('/');
				result.push({
					label,
					href: `/${pathUpToHere}`,
					...(icon && { icon }),
					...(computedOptions && { icon: computedOptions.icon, options: computedOptions.options }),
				});
			}
		}

		return result;
	}, [params.id, pathname, segmentOptionsData]);

	const guild = me?.guilds.find((g) => g.id === params.id);
	if (!guild) {
		throw new Error('guild not found, should not be rendering this component');
	}

	// Create dropdown options for other guilds with bots
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
					icon: <GuildIcon data={guild} disableLink hasBots />,
					options: guildOptions,
				},
				...segments,
			]}
		/>
	);
}
