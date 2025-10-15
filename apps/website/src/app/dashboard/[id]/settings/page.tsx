import { DashboardCrumbs } from '../../_components/DashboardCrumbs';
import { GrantsList } from './_components/GrantsList';
import { Heading } from '@/components/common/Heading';

export default function SettingsPage() {
	return (
		<>
			<div className="flex flex-col [&:not]:first-of-type:mt-8 [&>*]:first-of-type:mb-4">
				<DashboardCrumbs />
				<Heading
					subtitle="Manage who can access the dashboard for this server, outside of server admins"
					title="Server Settings"
				/>
			</div>

			<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
				<GrantsList />
			</div>
		</>
	);
}
