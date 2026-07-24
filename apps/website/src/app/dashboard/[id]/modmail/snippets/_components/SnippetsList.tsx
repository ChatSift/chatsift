'use client';

import { useParams } from 'next/navigation';
import { AddSnippetCard } from './AddSnippetCard';
import { SnippetCard } from './SnippetCard';
import { useModmailSnippets } from '@/api/routes/modmail';
import { Skeleton } from '@/components/common/Skeleton';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

export function SnippetsList() {
	const { id: guildId } = useParams<{ id: string }>();
	const { data: snippets, isLoading, error } = useModmailSnippets(guildId);

	// See GrantsList.tsx for why this also checks `snippets === undefined`: a background refetch failure keeps
	// the previously-cached list around, and that stale-but-present data should keep rendering normally rather
	// than being replaced by the full error state.
	if (error && snippets === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading) {
		return (
			<>
				<AddSnippetCard guildId={guildId} />
				<Skeleton className="h-48 w-full rounded-lg" />
				<Skeleton className="h-48 w-full rounded-lg" />
			</>
		);
	}

	return (
		<>
			<AddSnippetCard guildId={guildId} />
			{snippets!.map((snippet) => (
				<SnippetCard guildId={guildId} key={snippet.id} snippet={snippet} />
			))}
		</>
	);
}
