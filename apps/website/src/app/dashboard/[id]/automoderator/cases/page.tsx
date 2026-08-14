import { ActionFilter, IncludePardonedToggle } from './_components/CaseFilters';
import { CasesList } from './_components/CasesList';
import { Heading } from '@/components/common/Heading';
import { SearchBar } from '@/components/common/SearchBar';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function AutomoderatorCasesPage() {
	return (
		<>
			<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
				<DashboardCrumbs />
				<Heading subtitle="Every moderation action taken in this server" title="Cases" />
				<SearchBar placeholder="Filter by user id...">
					<ActionFilter />
					<IncludePardonedToggle />
				</SearchBar>
			</div>

			<CasesList />
		</>
	);
}
