import type { Metadata } from 'next';
import Heading from '~/components/common/Heading';
import GuildList from '~/components/dashboard/GuildList';
import RefreshGuildsButton from '~/components/dashboard/RefreshGuildsButton';
import MainLayout from '~/components/layout/MainLayout';

export const metadata: Metadata = {
	title: 'Dashboard',
};

export default async function Dashboard() {
	return (
		<MainLayout>
			<div className="flex flex-col [&:not]:first-of-type:mt-8 [&>*]:first-of-type:mb-6">
				<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
					<Heading title="Configure bots" subtitle="Select or add a community to manage." />
					<RefreshGuildsButton />
				</div>
			</div>
			<GuildList />
		</MainLayout>
	);
}
