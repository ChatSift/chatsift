import type { Metadata } from 'next';
import { Suspense } from 'react';
import Heading from '~/components/common/Heading';
import GuildList from '~/components/dashboard/GuildList';
import GuildSearchBar from '~/components/dashboard/GuildSearchBar';
import RefreshGuildsButton from '~/components/dashboard/RefreshGuildsButton';

export const metadata: Metadata = {
	title: 'Dashboard',
};

export default async function DashboardPage() {
	return (
		<div>
			<div className="flex flex-col [&:not]:first-of-type:mt-8 [&>*]:first-of-type:mb-4">
				<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
					<Heading title="Configure bots" subtitle="Select or add a community to manage." />
					<RefreshGuildsButton />
				</div>
				<Suspense>
					<GuildSearchBar />
				</Suspense>
			</div>
			<Suspense>
				<GuildList />
			</Suspense>
		</div>
	);
}
