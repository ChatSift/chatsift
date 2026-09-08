import { Heading } from '@chatsift/web-core/components/Heading';
import { EditSocialRoleFormLoader } from '../_components/SocialRoleForm';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { SocialGuildCrumbs } from '@/components/dashboard/SocialGuildCrumbs';

export default function EditSocialRolePage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<SocialGuildCrumbs />
			<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
				<Heading subtitle="Edit a configured role" title="Edit Role" />
				<RefreshServerDataButton for_bot="SOCIAL" />
			</div>
			<EditSocialRoleFormLoader />
		</div>
	);
}
