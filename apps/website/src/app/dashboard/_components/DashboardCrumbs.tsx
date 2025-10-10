'use client';

import { useParams, usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { GuildIcon } from '@/components/common/GuildIcon';
import { client } from '@/data/client';
import { sortGuilds } from '@/utils/util';

const SEGMENT_LABELS: Record<string, string> = {
	ama: 'AMA Bot',
	amas: 'AMA Sessions',
	new: 'New',
} as const;

export function DashboardCrumbs() {
	const { data: me } = client.auth.useMe();
	const params = useParams<{ id?: string }>();
	const pathname = usePathname();

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

			const label = SEGMENT_LABELS[part] ?? part;

			// Don't create an href for the last segment (current page)
			const isLastSegment = i === relevantParts.length - 1;
			if (isLastSegment) {
				result.push({ label });
			} else {
				// Build the href up to this segment
				const pathUpToHere = pathParts.slice(0, guildIdIndex + 2 + i).join('/');
				result.push({
					label,
					href: `/${pathUpToHere}`,
				});
			}
		}

		return result;
	}, [params.id, pathname]);

	if (!params.id) {
		throw new Error('id param not found, should not be rendering this component');
	}

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
