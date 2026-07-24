'use client';

import { useParams } from 'next/navigation';
import { CreatePanelCard } from './CreatePanelCard';
import { PanelCard } from './PanelCard';
import { useGuildInfo } from '@/api/routes/guilds';
import { useModmailPanels } from '@/api/routes/modmail';
import { Skeleton } from '@/components/common/Skeleton';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

export function PanelsList() {
	const { id: guildId } = useParams<{ id: string }>();
	const { data: panels, isLoading, error } = useModmailPanels(guildId);
	const { data: guildInfo } = useGuildInfo(guildId, 'MODMAIL');

	// See GrantsList.tsx for why this also checks `panels === undefined`: a background refetch failure keeps the
	// previously-cached list around, and that stale-but-present data should keep rendering normally rather than
	// being replaced by the full error state.
	if (error && panels === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading) {
		return (
			<>
				<CreatePanelCard />
				<Skeleton className="h-36 w-full rounded-lg" />
				<Skeleton className="h-36 w-full rounded-lg" />
			</>
		);
	}

	return (
		<>
			<CreatePanelCard />
			{panels!.map((panel) => (
				<PanelCard
					channelName={guildInfo?.channels.find((channel) => channel.id === panel.channelId)?.name}
					guildId={guildId}
					key={panel.id}
					panel={panel}
				/>
			))}
		</>
	);
}
