import { ReportPromptForm } from '../_components/ReportPromptForm';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function NewAutomoderatorReportPromptPage() {
	return (
		<div className="space-y-8">
			<PageHeader
				action={<RefreshServerDataButton for_bot="AUTOMODERATOR" />}
				subtitle="Post a message members can install the reporting app from"
				title="New Report Prompt"
			/>
			<ReportPromptForm />
		</div>
	);
}
