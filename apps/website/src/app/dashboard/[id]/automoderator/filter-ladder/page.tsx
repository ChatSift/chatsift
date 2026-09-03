import { TriggerDecayForm } from './_components/TriggerDecayForm';
import { TriggerLadderList } from './_components/TriggerLadderList';
import { TriggerLadderOverview } from './_components/TriggerLadderOverview';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function AutomoderatorFilterLadderPage() {
	return (
		<div className="space-y-8">
			<PageHeader
				subtitle="What happens as filter triggers pile up, and when they stop counting"
				title="Filter Ladder"
			/>
			<TriggerDecayForm />

			<div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 lg:grid-cols-3">
				<TriggerLadderOverview />
				<TriggerLadderList />
			</div>
		</div>
	);
}
