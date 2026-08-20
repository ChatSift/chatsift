import { EditBanwordPolicyFormLoader } from '../_components/BanwordPolicyForm';
import { Heading } from '@/components/common/Heading';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function EditBanwordPolicyPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<DashboardCrumbs />
			<Heading subtitle="Change what this rule does about the people it catches" title="Edit Policy" />
			<EditBanwordPolicyFormLoader />
		</div>
	);
}
