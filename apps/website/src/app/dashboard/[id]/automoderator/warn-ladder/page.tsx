import { AutoPardonForm } from './_components/AutoPardonForm';
import { WarnLadderList } from './_components/WarnLadderList';
import { WarnLadderOverview } from './_components/WarnLadderOverview';
import { Heading } from '@/components/common/Heading';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function AutomoderatorWarnLadderPage() {
	return (
		<>
			<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
				<DashboardCrumbs />
				<Heading subtitle="What happens as warnings pile up, and when they stop counting" title="Warn Ladder" />
				<AutoPardonForm />
			</div>

			<div className="mt-8 grid grid-cols-1 items-start gap-6 md:grid-cols-2 lg:grid-cols-3">
				<WarnLadderOverview />
				<WarnLadderList />
			</div>
		</>
	);
}
