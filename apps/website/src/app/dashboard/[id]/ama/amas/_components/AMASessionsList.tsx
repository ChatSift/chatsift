'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { AMASessionCard } from './AMASessionCard';
import { CreateAMACard } from './CreateAMACard';
import { client } from '@/data/client';

interface AMASessionsListProps {
	readonly guildId: string;
}

export function AMASessionsList({ guildId }: AMASessionsListProps) {
	const { data: sessions } = client.guilds.ama.useAMAs(guildId, { include_ended: false });
	const searchParams = useSearchParams();

	const searchQuery = searchParams.get('search') ?? '';

	const filtered = useMemo(() => {
		if (!sessions?.length) {
			return [];
		}

		const lower = searchQuery.toLowerCase();
		return sessions.filter((session) => session.title.toLowerCase().includes(lower));
	}, [sessions, searchQuery]);

	return (
		<ul className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-4">
			<li>
				<CreateAMACard guildId={guildId} />
			</li>
			{filtered.map((session) => (
				<li key={session.id}>
					<AMASessionCard data={session} guildId={guildId} />
				</li>
			))}
		</ul>
	);
}
