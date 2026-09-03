import { InviteFilterForm } from './_components/InviteFilterForm';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function AutomoderatorInviteFilterPage() {
	return (
		<div className="space-y-8">
			<PageHeader
				action={<RefreshServerDataButton for_bot="AUTOMODERATOR" />}
				subtitle="Which other servers members are allowed to link"
				title="Invite Filter"
			/>
			<InviteFilterForm />
		</div>
	);
}
