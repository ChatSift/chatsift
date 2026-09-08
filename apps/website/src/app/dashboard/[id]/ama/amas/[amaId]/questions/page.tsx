import { Heading } from '@chatsift/web-core/components/Heading';
import { SearchBar } from '@chatsift/web-core/components/SearchBar';
import { QuestionStateTabs } from './_components/QuestionStateTabs';
import { QuestionTagFilter } from './_components/QuestionTagFilter';
import { QuestionsList } from './_components/QuestionsList';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { AMADashboardCrumbs } from '@/components/dashboard/AMADashboardCrumbs';

export default function AMAQuestionsPage() {
	return (
		<>
			<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
				<AMADashboardCrumbs />
				<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
					<Heading subtitle="Triage, tag, prepare answers, and merge duplicates" title="Questions" />
					<RefreshServerDataButton for_bot="AMA" />
				</div>
				<QuestionStateTabs />
				<SearchBar placeholder="Search question content...">
					<QuestionTagFilter />
				</SearchBar>
			</div>

			<QuestionsList />
		</>
	);
}
