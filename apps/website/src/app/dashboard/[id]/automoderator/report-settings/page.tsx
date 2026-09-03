import { ReportPresetsForm } from './_components/ReportPresetsForm';
import { ReportsChannelForm } from './_components/ReportsChannelForm';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function AutomoderatorReportSettingsPage() {
	return (
		<div className="space-y-8">
			<PageHeader
				action={<RefreshServerDataButton for_bot="AUTOMODERATOR" />}
				subtitle="Where reports go, and what reporters can pick as a reason"
				title="Report Settings"
			/>
			<div className="space-y-6">
				<ReportsChannelForm />
				<ReportPresetsForm />
			</div>
		</div>
	);
}
