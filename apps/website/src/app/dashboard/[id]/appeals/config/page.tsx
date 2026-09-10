import { Heading } from '@chatsift/web-core/components/Heading';
import { AppealsConfigForm } from './_components/AppealsConfigForm';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function AppealsConfigPage() {
	return (
		<div className="space-y-8">
			<div className="flex flex-col gap-4">
				<DashboardCrumbs />
				<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
					<Heading
						subtitle="Where appeals are posted, how often somebody may appeal, and what approval does"
						title="Appeals Config"
					/>
					<RefreshServerDataButton for_bot="APPEALS" />
				</div>
			</div>

			<AppealsConfigForm />
		</div>
	);
}
