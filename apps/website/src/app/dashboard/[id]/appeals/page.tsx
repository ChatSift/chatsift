import { Heading } from '@chatsift/web-core/components/Heading';
import { AppealsSectionList } from './_components/AppealsSectionList';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function AppealsPage() {
	return (
		<div className="space-y-8">
			<div className="flex flex-col gap-4">
				<DashboardCrumbs />
				<Heading subtitle="Configure Appeals for your server" title="Appeals Settings" />
				<AppealsSectionList />
			</div>
		</div>
	);
}
