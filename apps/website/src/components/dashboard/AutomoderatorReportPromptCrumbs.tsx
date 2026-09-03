'use client';

import { useParams } from 'next/navigation';
import { DashboardCrumbs } from './DashboardCrumbs';
import { useAutomoderatorReportPrompts } from '@/api/routes/automoderatorReports';
import { useGuildInfo } from '@/api/routes/guilds';

/**
 * Resolves the `automoderator/report-prompts/[promptId]` segment to the channel the prompt was posted in
 * (#373) -- mirrors `ModmailPanelCrumbs`, for the same reason: neither row has a name of its own.
 */
export function AutomoderatorReportPromptCrumbs() {
	const { id: guildId } = useParams<{ id: string }>();

	const { data: prompts } = useAutomoderatorReportPrompts(guildId);
	const { data: guildInfo } = useGuildInfo(guildId, 'AUTOMODERATOR');

	return (
		<DashboardCrumbs
			segmentOptionsData={{
				automoderatorChannels: guildInfo?.channels,
				automoderatorReportPrompts: prompts,
			}}
		/>
	);
}
