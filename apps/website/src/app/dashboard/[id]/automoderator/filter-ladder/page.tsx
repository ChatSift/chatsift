import { TriggerDecayForm } from './_components/TriggerDecayForm';
import { TriggerLadderList } from './_components/TriggerLadderList';
import { TriggerLadderOverview } from './_components/TriggerLadderOverview';
import { Heading } from '@/components/common/Heading';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function AutomoderatorFilterLadderPage() {
	return (
		<>
			<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
				<DashboardCrumbs />
				<Heading
					subtitle="What happens as filter triggers pile up, and when they stop counting"
					title="Filter Ladder"
				/>
				<TriggerDecayForm />
			</div>

			<div className="mt-8 grid grid-cols-1 items-start gap-6 md:grid-cols-2 lg:grid-cols-3">
				<TriggerLadderOverview />
				<TriggerLadderList />
			</div>
		</>
	);
}
