import { SocialInertBanner } from '../_components/SocialInertBanner';
import { SocialChannelsList } from './_components/SocialChannelsList';
import { Heading } from '@/components/common/Heading';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function SocialChannelsPage() {
	return (
		<>
			<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
				<DashboardCrumbs />
				<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
					<Heading subtitle="Channels that grant no XP, or grant it faster" title="Social Channels" />
					<RefreshServerDataButton for_bot="SOCIAL" />
				</div>
				<SocialInertBanner />
			</div>

			<div className="mt-8 grid grid-cols-1 items-start gap-6 md:grid-cols-2 lg:grid-cols-3">
				<SocialChannelsList />
			</div>
		</>
	);
}
