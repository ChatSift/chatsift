'use client';

import type { AMASessionDetailed, AMASessionWithCount } from '@chatsift/api';
import { useParams } from 'next/navigation';
import { DashboardCrumbs } from '../../../_components/DashboardCrumbs';
import { client } from '@/data/client';

function useCurrentAMA(id: string, amaId?: string) {
	if (!amaId) return undefined;
	const { data: currentAMA } = client.guilds.ama.useAMA(id, amaId);
	return currentAMA as AMASessionDetailed | undefined;
}

export function AMADashboardCrumbs() {
	const params = useParams<{ amaId?: string; id: string }>();

	const { data: amaSessions } = client.guilds.ama.useAMAs(params.id, {
		include_ended: 'false',
	});
	const currentAMA = useCurrentAMA(params.id, params.amaId);

	return (
		<DashboardCrumbs
			segmentOptionsData={{
				amaSessions: amaSessions as AMASessionWithCount[] | undefined,
				currentAMA,
			}}
		/>
	);
}
