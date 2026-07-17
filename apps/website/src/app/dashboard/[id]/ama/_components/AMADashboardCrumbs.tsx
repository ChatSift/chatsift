'use client';

import { useParams } from 'next/navigation';
import { DashboardCrumbs } from '../../../_components/DashboardCrumbs';
import type { AMASessionDetailed, AMASessionWithCount } from '@/api/routes/ama';
import { useAMA, useAMAs } from '@/api/routes/ama';

function useCurrentAMA(id: string, amaId?: string) {
	const { data: currentAMA } = useAMA(id, amaId);
	return amaId ? (currentAMA as AMASessionDetailed | undefined) : undefined;
}

export function AMADashboardCrumbs() {
	const params = useParams<{ amaId?: string; id: string }>();

	const { data: amaSessions } = useAMAs(params.id, false);
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
