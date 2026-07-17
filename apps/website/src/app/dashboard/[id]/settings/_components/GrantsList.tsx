'use client';

import { useParams } from 'next/navigation';
import { AddGrantCard } from './AddGrantCard';
import { GrantCard } from './GrantCard';
import { useGrants } from '@/api/routes/guilds';
import { Skeleton } from '@/components/common/Skeleton';

export function GrantsList() {
	const { id: guildId } = useParams<{ id: string }>();
	const { data, isLoading } = useGrants(guildId);

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
