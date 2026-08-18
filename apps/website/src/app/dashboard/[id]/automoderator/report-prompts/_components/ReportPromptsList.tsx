'use client';

import { useParams } from 'next/navigation';
import { CreateReportPromptCard } from './CreateReportPromptCard';
import { ReportPromptCard } from './ReportPromptCard';
import { useAutomoderatorConfig } from '@/api/routes/automoderator';
import { useAutomoderatorReportPrompts } from '@/api/routes/automoderatorReports';
import { useGuildInfo } from '@/api/routes/guilds';
import { Skeleton } from '@/components/common/Skeleton';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

export function ReportPromptsList() {
	const { id: guildId } = useParams<{ id: string }>();
	const { data: prompts, isLoading, error } = useAutomoderatorReportPrompts(guildId);
	const { data: guildInfo } = useGuildInfo(guildId, 'AUTOMODERATOR');
	const { data: config, isLoading: isLoadingConfig } = useAutomoderatorConfig(guildId);

	// See GrantsList.tsx for why this also checks `prompts === undefined`: a background refetch failure keeps the
	// cached list around, and stale-but-present data should keep rendering rather than being replaced wholesale.
	if (error && prompts === undefined) {
		return <UserErrorHandler error={error} />;
	}

	// Disabled until the config answer is actually known, not merely while the prompt list loads: defaulting to
	// enabled let a guild with no reports channel open the form during that window and get rejected on submit.
	const canCreate = Boolean(config?.reportsChannelId) && !isLoadingConfig;

	if (isLoading) {
		return (
			<>
				<CreateReportPromptCard isDisabled={!canCreate} />
				<Skeleton className="h-36 w-full rounded-lg" />
			</>
		);
	}

	return (
		<>
			{/* The API refuses to post a prompt with no reports channel set, so the card says why up front rather
			    than letting someone fill in a whole form to be rejected at the end. */}
			<CreateReportPromptCard isDisabled={!canCreate} />
			{prompts!.map((prompt) => (
				<ReportPromptCard
					channelName={guildInfo?.channels.find((channel) => channel.id === prompt.channelId)?.name}
					guildId={guildId}
					key={prompt.id}
					prompt={prompt}
				/>
			))}
		</>
	);
}
