import { AppealDetail } from './_components/AppealDetail';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function AppealPage() {
	return (
		<div className="flex flex-col gap-4">
			<DashboardCrumbs />
			<AppealDetail />
		</div>
	);
}
