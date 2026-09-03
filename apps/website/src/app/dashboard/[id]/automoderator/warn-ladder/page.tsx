import { AutoPardonForm } from './_components/AutoPardonForm';
import { WarnLadderList } from './_components/WarnLadderList';
import { WarnLadderOverview } from './_components/WarnLadderOverview';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function AutomoderatorWarnLadderPage() {
	return (
		<div className="space-y-8">
			<PageHeader subtitle="What happens as warnings pile up, and when they stop counting" title="Warn Ladder" />
			<AutoPardonForm />

			<div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 lg:grid-cols-3">
				<WarnLadderOverview />
				<WarnLadderList />
			</div>
		</div>
	);
}
