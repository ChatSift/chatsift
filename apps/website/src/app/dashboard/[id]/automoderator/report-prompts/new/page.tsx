import { ReportPromptForm } from '../_components/ReportPromptForm';
import { Heading } from '@/components/common/Heading';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function NewAutomoderatorReportPromptPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<DashboardCrumbs />
			<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
				<Heading subtitle="Post a message members can install the reporting app from" title="New Report Prompt" />
				<RefreshServerDataButton for_bot="AUTOMODERATOR" />
			</div>
			<ReportPromptForm />
		</div>
	);
}
