import { ReportPresetsForm } from './_components/ReportPresetsForm';
import { ReportsChannelForm } from './_components/ReportsChannelForm';
import { Heading } from '@/components/common/Heading';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function AutomoderatorReportSettingsPage() {
	return (
		<div className="flex flex-col gap-6">
			<DashboardCrumbs />
			<Heading subtitle="Where reports go, and what reporters can pick as a reason" title="Report Settings" />
			<ReportsChannelForm />
			<ReportPresetsForm />
		</div>
	);
}
