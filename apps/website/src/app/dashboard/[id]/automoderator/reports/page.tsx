import { StateFilter } from './_components/ReportFilters';
import { ReportsList } from './_components/ReportsList';
import { SearchBar } from '@/components/common/SearchBar';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function AutomoderatorReportsPage() {
	return (
		<div className="space-y-8">
			<PageHeader
				subtitle="What members have flagged to your staff team. Handle them from the card in your reports channel."
				title="Reports"
			/>

			<div className="space-y-4">
				<SearchBar placeholder="Filter by user id...">
					<StateFilter />
				</SearchBar>
				<ReportsList />
			</div>
		</div>
	);
}
