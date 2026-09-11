import { SearchBar } from '@chatsift/web-core/components/SearchBar';
import { StatusFilter } from './_components/AppealFilters';
import { AppealsList } from './_components/AppealsList';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function AppealsQueuePage() {
	return (
		<div className="space-y-8">
			<PageHeader
				subtitle="Every appeal filed against this server. The same three decisions are on the card in your mod channel, and either surface updates the other."
				title="Appeals"
			/>

			<div className="space-y-4">
				<SearchBar placeholder="Filter by user id...">
					<StatusFilter />
				</SearchBar>
				<AppealsList />
			</div>
		</div>
	);
}
