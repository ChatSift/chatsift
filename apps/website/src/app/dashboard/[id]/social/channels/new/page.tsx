import { SocialChannelForm } from '../_components/SocialChannelForm';
import { Heading } from '@/components/common/Heading';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function NewSocialChannelPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<DashboardCrumbs />
			<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
				<Heading subtitle="Silence a channel, or make it grant XP faster" title="Add Channel" />
				<RefreshServerDataButton for_bot="SOCIAL" />
			</div>
			<SocialChannelForm />
		</div>
	);
}
