import { QuestionStateTabs } from './_components/QuestionStateTabs';
import { QuestionTagFilter } from './_components/QuestionTagFilter';
import { QuestionsList } from './_components/QuestionsList';
import { Heading } from '@/components/common/Heading';
import { SearchBar } from '@/components/common/SearchBar';
import { AMADashboardCrumbs } from '@/components/dashboard/AMADashboardCrumbs';

export default function AMAQuestionsPage() {
	return (
		<>
			<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
				<AMADashboardCrumbs />
				<Heading subtitle="Triage, tag, prepare answers, and merge duplicates" title="Questions" />
				<QuestionStateTabs />
				<SearchBar placeholder="Search question content...">
					<QuestionTagFilter />
				</SearchBar>
			</div>

			<QuestionsList />
		</>
	);
}
