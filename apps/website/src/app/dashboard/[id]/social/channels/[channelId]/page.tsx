import { EditSocialChannelFormLoader } from '../_components/SocialChannelForm';
import { Heading } from '@/components/common/Heading';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { SocialGuildCrumbs } from '@/components/dashboard/SocialGuildCrumbs';

export default function EditSocialChannelPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<SocialGuildCrumbs />
			<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
				<Heading subtitle="Edit a configured channel" title="Edit Channel" />
				<RefreshServerDataButton for_bot="SOCIAL" />
			</div>
			<EditSocialChannelFormLoader />
		</div>
	);
}
