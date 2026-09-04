import { JoinGateForm } from './_components/JoinGateForm';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function AutomoderatorJoinGatePage() {
	return (
		<div className="space-y-8">
			<PageHeader subtitle="How old an account has to be before it can join" title="Join Gate" />
			<JoinGateForm />
		</div>
	);
}
