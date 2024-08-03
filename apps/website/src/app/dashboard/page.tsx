import type { Metadata } from 'next';
import { Suspense } from 'react';
import GuildList from '~/components/GuildList';
import Heading from '~/components/Heading';
import RefreshGuildsButton from '~/components/RefreshGuildsButton';

export const metadata: Metadata = {
	title: 'Dashboard',
};

export default function Dashboard() {
	return (
		<main className="m-[0_auto] mx-auto flex h-full w-fit flex-[1_0_auto] flex-col items-stretch justify-between p-4 md:min-w-[912px]">
			<div className="flex flex-col [&:not]:first-of-type:mt-8 [&>*]:first-of-type:mb-6">
				<div className="g-4 flex flex-col items-start justify-between md:flex-row md:items-center">
					<Heading title="Configure bots" subtitle="Select or add a community to manage." />
					<RefreshGuildsButton />
				</div>
			</div>
			<Suspense>
				<GuildList />
			</Suspense>
		</main>
	);
}
