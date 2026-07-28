import { IncludeClosedToggle } from './_components/IncludeClosedToggle';
import { ThreadsList } from './_components/ThreadsList';
import { Heading } from '@/components/common/Heading';
import { SearchBar } from '@/components/common/SearchBar';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function ModmailThreadsPage() {
	return (
		<>
			<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
				<DashboardCrumbs />
				<Heading subtitle="Browse past and open ModMail threads" title="ModMail Threads" />
				<SearchBar placeholder="Search by user (name or id)...">
					<IncludeClosedToggle />
				</SearchBar>
			</div>

			<ThreadsList />
		</>
	);
}
