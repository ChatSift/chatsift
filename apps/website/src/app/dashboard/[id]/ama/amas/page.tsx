import { AMASessionsList } from './_components/AMASessionsList';
import { IncludeEndedToggle } from './_components/IncludeEndedToggle';
import { SortMenu } from './_components/SortMenu';
import { Heading } from '@/components/common/Heading';
import { SearchBar } from '@/components/common/SearchBar';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function AMAMangementPage() {
	return (
		<>
			<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
				<DashboardCrumbs />
				<Heading subtitle="Create and manage AMAs in your community" title="AMA sessions" />
				<SearchBar placeholder="Search AMA sessions...">
					<SortMenu />
					<IncludeEndedToggle />
				</SearchBar>
			</div>

			<AMASessionsList />
		</>
	);
}
