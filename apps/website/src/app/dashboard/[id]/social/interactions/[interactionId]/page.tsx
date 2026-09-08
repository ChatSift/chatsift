import { Heading } from '@chatsift/web-core/components/Heading';
import { EditSocialInteractionFormLoader } from '../_components/SocialInteractionForm';
import { SocialInteractionCrumbs } from '@/components/dashboard/SocialInteractionCrumbs';

export default function EditSocialInteractionPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<SocialInteractionCrumbs />
			<Heading subtitle="Edit an existing interaction" title="Edit Interaction" />
			<EditSocialInteractionFormLoader />
		</div>
	);
}
