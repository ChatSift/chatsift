import { EditSocialInteractionFormLoader } from '../_components/SocialInteractionForm';
import { Heading } from '@/components/common/Heading';
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
