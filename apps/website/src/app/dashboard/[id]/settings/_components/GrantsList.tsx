'use client';

import { useParams } from 'next/navigation';
import { AddGrantCard } from './AddGrantCard';
import { GrantCard } from './GrantCard';
import { useGrants } from '@/api/routes/guilds';
import { Skeleton } from '@/components/common/Skeleton';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

export function GrantsList() {
	const { id: guildId } = useParams<{ id: string }>();
	const { data, isLoading, error } = useGrants(guildId);

	// `error` alone isn't enough to gate on: a *background* refetch failure keeps the previously-cached `data`
	// (react-query's error reducer doesn't clear it), so bail out to the full error state only when there's
	// nothing cached to keep showing. A background failure with data still on screen is the `ErrorBanner`'s job.
	if (error && data === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading) {
		return (
			<>
				<AddGrantCard guildId={guildId} />
				<Skeleton className="w-full rounded-lg" />
				<Skeleton className="w-full rounded-lg" />
			</>
		);
	}

	return (
		<>
			<AddGrantCard guildId={guildId} />
			{data!.grants.map((grant) => {
				const userId = typeof grant.user === 'string' ? grant.user : grant.user.id;
				return <GrantCard grant={grant} guildId={guildId} key={userId} />;
			})}
		</>
	);
}
