import { SocialInteractionForm } from '../_components/SocialInteractionForm';
import { Heading } from '@/components/common/Heading';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function NewSocialInteractionPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<DashboardCrumbs />
			<Heading subtitle="Add a custom slash command anyone in the server can use" title="New Interaction" />
			<SocialInteractionForm />
		</div>
	);
}
