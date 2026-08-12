import { SocialInertBanner } from '../_components/SocialInertBanner';
import { RewardLadder } from './_components/RewardLadder';
import { SocialRewardsList } from './_components/SocialRewardsList';
import { Heading } from '@/components/common/Heading';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function SocialRewardsPage() {
	return (
		<>
			<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
				<DashboardCrumbs />
				<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
					<Heading subtitle="Roles handed out when members reach a level" title="Social Rewards" />
					<RefreshServerDataButton for_bot="SOCIAL" />
				</div>
				<SocialInertBanner />
			</div>

			<div className="mt-8 grid grid-cols-1 items-start gap-6 md:grid-cols-2 lg:grid-cols-3">
				<RewardLadder />
				<SocialRewardsList />
			</div>
		</>
	);
}
