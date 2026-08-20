import { BanwordPolicyForm } from '../_components/BanwordPolicyForm';
import { Heading } from '@/components/common/Heading';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function NewBanwordPolicyPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<DashboardCrumbs />
			<Heading subtitle="Attach a punishment to one of this server's AutoMod rules" title="Add Policy" />
			<BanwordPolicyForm />
		</div>
	);
}
