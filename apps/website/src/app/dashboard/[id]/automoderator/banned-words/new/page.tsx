import { BanwordPolicyForm } from '../_components/BanwordPolicyForm';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function NewBanwordPolicyPage() {
	return (
		<div className="space-y-8">
			<PageHeader subtitle="Attach a punishment to one of this server's AutoMod rules" title="Add Policy" />
			<BanwordPolicyForm />
		</div>
	);
}
