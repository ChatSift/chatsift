import { ReportPresetsForm } from './_components/ReportPresetsForm';
import { ReportsChannelForm } from './_components/ReportsChannelForm';
import { Heading } from '@/components/common/Heading';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function AutomoderatorReportSettingsPage() {
	return (
		<div className="flex flex-col gap-6">
			<DashboardCrumbs />
			<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
				<Heading subtitle="Where reports go, and what reporters can pick as a reason" title="Report Settings" />
				<RefreshServerDataButton for_bot="AUTOMODERATOR" />
			</div>
			<ReportsChannelForm />
			<ReportPresetsForm />
		</div>
	);
}
