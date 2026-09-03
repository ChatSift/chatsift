import { ReportPromptsList } from './_components/ReportPromptsList';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function AutomoderatorReportPromptsPage() {
	return (
		<div className="space-y-8">
			<PageHeader
				action={<RefreshServerDataButton for_bot="AUTOMODERATOR" />}
				subtitle="Messages telling members how to report DMs to this server"
				title="Report Prompts"
			/>

			<div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 lg:grid-cols-3">
				<ReportPromptsList />
			</div>
		</div>
	);
}
