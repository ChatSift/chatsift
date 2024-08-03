'use client';

import SearchBar from '~/components/common/SearchBar';
import { useQueryUserMe } from '~/data/userMe/client';

export default function GuildSearchBar() {
	const { isLoading } = useQueryUserMe();

	return <SearchBar placeholder="Search for a server" aria-label="Search for a server" isDisabled={isLoading} />;
}
