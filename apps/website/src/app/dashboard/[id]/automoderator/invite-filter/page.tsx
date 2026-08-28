import { InviteFilterForm } from './_components/InviteFilterForm';
import { Heading } from '@/components/common/Heading';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function AutomoderatorInviteFilterPage() {
	return (
		<div className="flex flex-col gap-4">
			<DashboardCrumbs />
			<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
				<Heading subtitle="Which other servers members are allowed to link" title="Invite Filter" />
				<RefreshServerDataButton for_bot="AUTOMODERATOR" />
			</div>
			<InviteFilterForm />
		</div>
	);
}
