import { ActionFilter, IncludePardonedToggle } from './_components/CaseFilters';
import { CasesList } from './_components/CasesList';
import { SearchBar } from '@/components/common/SearchBar';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function AutomoderatorCasesPage() {
	return (
		<div className="space-y-8">
			<PageHeader subtitle="Every moderation action taken in this server" title="Cases" />

			<div className="space-y-4">
				<SearchBar placeholder="Filter by user id...">
					<ActionFilter />
					<IncludePardonedToggle />
				</SearchBar>
				<CasesList />
			</div>
		</div>
	);
}
