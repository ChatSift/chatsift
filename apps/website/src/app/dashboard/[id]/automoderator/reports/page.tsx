import { StateFilter } from './_components/ReportFilters';
import { ReportsList } from './_components/ReportsList';
import { Heading } from '@/components/common/Heading';
import { SearchBar } from '@/components/common/SearchBar';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function AutomoderatorReportsPage() {
	return (
		<>
			<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
				<DashboardCrumbs />
				<Heading
					subtitle="What members have flagged to your staff team. Handle them from the card in your reports channel."
					title="Reports"
				/>
				<SearchBar placeholder="Filter by user id...">
					<StateFilter />
				</SearchBar>
			</div>

			<ReportsList />
		</>
	);
}
