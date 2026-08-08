import { AMASessionsHeading } from './_components/AMASessionsHeading';
import { AMASessionsList } from './_components/AMASessionsList';
import { IncludeEndedToggle } from './_components/IncludeEndedToggle';
import { SortMenu } from './_components/SortMenu';
import { SearchBar } from '@/components/common/SearchBar';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function AMAMangementPage() {
	return (
		<>
			<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
				<DashboardCrumbs />
				<AMASessionsHeading />
				<SearchBar placeholder="Search AMA sessions...">
					<SortMenu />
					<IncludeEndedToggle />
				</SearchBar>
			</div>

			<AMASessionsList />
		</>
	);
}
