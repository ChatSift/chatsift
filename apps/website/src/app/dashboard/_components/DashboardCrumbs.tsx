'use client';

import { useParams } from 'next/navigation';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { client } from '@/data/client';
import { sortGuilds } from '@/utils/util';

export interface DashboardCrumbSegment {
	readonly href?: string;
	readonly label: string;
}

interface DashboardCrumbProps {
	readonly segments: DashboardCrumbSegment[];
}

export function DashboardCrumbs({ segments }: DashboardCrumbProps) {
	const { data: me } = client.auth.useMe();
	const params = useParams<{ id?: string }>();

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
					highlight: true,
					...(guildOptions.length > 0 && { options: guildOptions }),
				},
				...segments.map(({ href, ...rest }) => {
					if (href) {
						return {
							href: href.replace('[id]', guild.id),
							...rest,
						};
					}

					return rest;
				}),
			]}
		/>
	);
}
