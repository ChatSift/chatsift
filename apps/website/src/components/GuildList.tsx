'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { useLoggedInUser } from '~/hooks/useLoggedInUser';

export default function GuildList() {
	const { data } = useLoggedInUser();
	const searchParams = useSearchParams();

	const searchQuery = searchParams.get('search') ?? '';

	const filtered = useMemo(() => {
		if (!data) {
			return [];
		}

		return data.guilds.filter((guild) => guild.name.includes(searchQuery));
	}, [data, searchQuery]);

	const sorted = useMemo(() => {
		return filtered.sort((a, b) => {
			if (a.bots.length && b.bots.length) {
				return b.bots.length - a.bots.length;
			}

			return 0;
		});
	}, [filtered]);

	return <></>;
}
