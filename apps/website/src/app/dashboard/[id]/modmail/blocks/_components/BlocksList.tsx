'use client';

import { useParams } from 'next/navigation';
import { BlockCard } from './BlockCard';
import { useModmailBlocks } from '@/api/routes/modmail';
import { Skeleton } from '@/components/common/Skeleton';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

export function BlocksList() {
	const { id: guildId } = useParams<{ id: string }>();
	const { data: blocks, isLoading, error } = useModmailBlocks(guildId);

	// See GrantsList.tsx for why this also checks `blocks === undefined`: a background refetch failure keeps
	// the previously-cached list around, and that stale-but-present data should keep rendering normally rather
	// than being replaced by the full error state.
	if (error && blocks === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading) {
		return (
			<>
				<Skeleton className="h-32 w-full rounded-lg" />
				<Skeleton className="h-32 w-full rounded-lg" />
			</>
		);
	}

	if (blocks!.length === 0) {
		return <p className="text-sm text-secondary dark:text-secondary-dark">No blocked users.</p>;
	}

	return (
		<>
			{blocks!.map((block) => {
				const userId = typeof block.user === 'string' ? block.user : block.user.id;
				return <BlockCard block={block} guildId={guildId} key={userId} />;
			})}
		</>
	);
}
