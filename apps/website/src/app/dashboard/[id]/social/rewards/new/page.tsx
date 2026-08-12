import { SocialRewardForm } from '../_components/SocialRewardForm';
import { Heading } from '@/components/common/Heading';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function NewSocialRewardPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<DashboardCrumbs />
			<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
				<Heading subtitle="Hand out a role when members reach a level" title="Add Reward" />
				<RefreshServerDataButton for_bot="SOCIAL" />
			</div>
			<SocialRewardForm />
		</div>
	);
}
