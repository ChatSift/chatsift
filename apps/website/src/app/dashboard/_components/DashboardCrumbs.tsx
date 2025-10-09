'use client';

import { useParams } from 'next/navigation';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { client } from '@/data/client';

export interface DashboardCrumbSegment {
	readonly href?: string;
	readonly label: string;
}

interface DashboardCrumbProps {
	readonly segments: DashboardCrumbSegment[];
}

export function DashboardCrumbs({ segments }: DashboardCrumbProps) {
	const { data: me } = client.auth.useMe();
	const params = useParams<{ id: string }>();

	const guild = me?.guilds.find((g) => g.id === params.id);

	if (!guild) {
		throw new Error('guild not found, should not be rendering this component');
	}

	return (
		<Breadcrumb
			segments={[
				{ label: 'Servers', href: '/dashboard' },
				{ label: guild.name, href: segments.length === 0 ? undefined : `/dashboard/${guild.id}`, highlight: true },
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
