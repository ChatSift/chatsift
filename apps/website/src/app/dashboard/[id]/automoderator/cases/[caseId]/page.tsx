import { CaseDetail } from './_components/CaseDetail';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function AutomoderatorCasePage() {
	return (
		<div className="flex flex-col gap-4">
			<DashboardCrumbs />
			<CaseDetail />
		</div>
	);
}
