import { EditBanwordPolicyFormLoader } from '../_components/BanwordPolicyForm';
import { AutomoderatorBanwordPolicyCrumbs } from '@/components/dashboard/AutomoderatorBanwordPolicyCrumbs';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function EditBanwordPolicyPage() {
	return (
		<div className="space-y-8">
			<PageHeader
				crumbs={<AutomoderatorBanwordPolicyCrumbs />}
				subtitle="Change what this rule does about the people it catches"
				title="Edit Policy"
			/>
			<EditBanwordPolicyFormLoader />
		</div>
	);
}
