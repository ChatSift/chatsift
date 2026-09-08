import { Heading } from '@chatsift/web-core/components/Heading';
import { CreateQuestionForm } from './_components/CreateQuestionForm';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { AMADashboardCrumbs } from '@/components/dashboard/AMADashboardCrumbs';

export default function NewAMAQuestionPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<AMADashboardCrumbs />
			<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
				<Heading subtitle="Write a question yourself for duplicates to be merged into" title="New umbrella question" />
				<RefreshServerDataButton for_bot="AMA" />
			</div>
			<CreateQuestionForm />
		</div>
	);
}
