'use client';

import { useParams } from 'next/navigation';
import { AddGrantCard } from './AddGrantCard';
import { GrantCard } from './GrantCard';
import { Skeleton } from '@/components/common/Skeleton';
import { client } from '@/data/client';

export function GrantsList() {
	const { id: guildId } = useParams<{ id: string }>();
	const { data, isLoading } = client.guilds.grants.useGrants(guildId);

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
			{data!.users.map((user, index) => (
				<GrantCard guildId={guildId} isLoading={isLoading} key={index} user={user} />
			))}
		</>
	);
}
