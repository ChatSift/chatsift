'use client';

import { useParams } from 'next/navigation';
import { DashboardCrumbs } from '../../../_components/DashboardCrumbs';
import { useGuildInfo } from '@/api/routes/guilds';
import { useModmailPanels } from '@/api/routes/modmail';

/**
 * Resolves the `modmail/panels/[panelId]` breadcrumb segment to the panel's channel name (e.g.
 * "#general") instead of the raw numeric id — mirrors `AMADashboardCrumbs`'s equivalent for
 * `ama/amas/[amaId]`, since panels have no title field to fall back on the way AMA sessions do.
 */
export function ModmailPanelCrumbs() {
	const { id: guildId } = useParams<{ id: string }>();

	const { data: panels } = useModmailPanels(guildId);
	const { data: guildInfo } = useGuildInfo(guildId, 'MODMAIL');

	return (
		<DashboardCrumbs
			segmentOptionsData={{
				modmailChannels: guildInfo?.channels,
				modmailPanels: panels,
			}}
		/>
	);
}
