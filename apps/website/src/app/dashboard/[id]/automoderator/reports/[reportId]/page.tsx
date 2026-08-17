import { ReportDetail } from './_components/ReportDetail';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function AutomoderatorReportPage() {
	return (
		<div className="flex flex-col gap-4">
			<DashboardCrumbs />
			<ReportDetail />
		</div>
	);
}
