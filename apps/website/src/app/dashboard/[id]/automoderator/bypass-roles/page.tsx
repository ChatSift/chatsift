import { BypassRolesForm } from './_components/BypassRolesForm';
import { Heading } from '@/components/common/Heading';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function AutomoderatorBypassRolesPage() {
	return (
		<div className="flex flex-col gap-4">
			<DashboardCrumbs />
			<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
				<Heading subtitle="Roles the filters never punish" title="Bypass Roles" />
				<RefreshServerDataButton for_bot="AUTOMODERATOR" />
			</div>
			<BypassRolesForm />
		</div>
	);
}
