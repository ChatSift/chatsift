import { Heading } from '@chatsift/web-core/components/Heading';
import { SearchBar } from '@chatsift/web-core/components/SearchBar';
import type { Metadata } from 'next';
import { DashboardLinkErrorNotice } from './_components/DashboardLinkErrorNotice';
import { GuildList } from './_components/GuildList';
import { RefreshGuildsButton } from './_components/RefreshGuildsButton';

export const metadata: Metadata = {
	title: 'Dashboard',
};

export default function DashboardPage() {
	return (
		<>
			<DashboardLinkErrorNotice />
			<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
				<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
					<Heading subtitle="Select or add a community to manage." title="Configure bots" />
					<RefreshGuildsButton />
				</div>
				<SearchBar placeholder="Search guilds..." />
			</div>
			<GuildList />
		</>
	);
}
