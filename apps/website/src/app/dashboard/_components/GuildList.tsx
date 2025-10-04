'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import GuildCard from './GuildCard';
import { client } from '@/data/client';

export function GuildList() {
	const { data: me } = client.auth.useMe();
	const searchParams = useSearchParams();

	const searchQuery = searchParams.get('search') ?? '';

	const sorted = useMemo(() => {
		const lower = searchQuery.toLowerCase();

		if (!me) {
			return [];
		}

		const filtered = me.guilds.filter((guild) => guild.name.toLowerCase().includes(lower));
		return filtered.reverse().sort((a, b) => b.bots.length - a.bots.length);
	}, [me, searchQuery]);

	return (
		<ul className="grid grid-cols-1 gap-4 md:grid-cols-4">
			{sorted.map((guild) => (
				<li key={guild.id}>
					<GuildCard data={guild} />
				</li>
			))}
		</ul>
	);
}
