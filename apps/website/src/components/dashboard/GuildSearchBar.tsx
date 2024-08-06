'use client';

import SearchBar from '~/components/common/SearchBar';
import { client } from '~/data/client';

export default function GuildSearchBar() {
	const { isLoading } = client.useMe();

	return <SearchBar placeholder="Search for a server" aria-label="Search for a server" isDisabled={isLoading} />;
}
