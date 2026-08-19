import { LogExemptionsForm } from './_components/LogExemptionsForm';
import { Heading } from '@/components/common/Heading';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function AutomoderatorLogExemptionsPage() {
	return (
		<div className="flex flex-col gap-4">
			<DashboardCrumbs />
			<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
				<Heading subtitle="Channels the message log leaves alone" title="Log Exemptions" />
				<RefreshServerDataButton for_bot="AUTOMODERATOR" />
			</div>
			<LogExemptionsForm />
		</div>
	);
}
