'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import GuildCard from '~/components/dashboard/GuildCard';
import { useLoggedInUser } from '~/hooks/useLoggedInUser';

export default function GuildList() {
	const { data } = useLoggedInUser();
	const searchParams = useSearchParams();

	const searchQuery = searchParams.get('search') ?? '';

	const sorted = useMemo(() => {
		const lower = searchQuery.toLowerCase();

		if (!data) {
			return [];
		}

		const filtered = data.guilds.filter((guild) => guild.name.toLowerCase().includes(lower));
		return filtered.reverse().sort((a, b) => {
			return b.bots.length - a.bots.length;
		});
	}, [data, searchQuery]);

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
