import { EditReportPromptFormLoader } from './_components/EditReportPromptForm';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { AutomoderatorReportPromptCrumbs } from '@/components/dashboard/AutomoderatorReportPromptCrumbs';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function EditAutomoderatorReportPromptPage() {
	return (
		<div className="space-y-8">
			<PageHeader
				action={<RefreshServerDataButton for_bot="AUTOMODERATOR" />}
				crumbs={<AutomoderatorReportPromptCrumbs />}
				subtitle="Rewrite a prompt already posted in your server"
				title="Edit Report Prompt"
			/>
			<EditReportPromptFormLoader />
		</div>
	);
}
