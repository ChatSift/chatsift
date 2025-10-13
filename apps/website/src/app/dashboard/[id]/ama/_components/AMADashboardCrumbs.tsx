'use client';

import { useParams } from 'next/navigation';
import { DashboardCrumbs } from '../../../_components/DashboardCrumbs';
import { client } from '@/data/client';

export function AMADashboardCrumbs() {
	const params = useParams<{ id: string }>();

	const { data: amaSessions } = client.guilds.ama.useAMAs(params.id, {
		include_ended: 'false',
	});

	return <DashboardCrumbs segmentOptionsData={{ amaSessions }} />;
}
