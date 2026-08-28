import { FilterExemptionsForm } from './_components/FilterExemptionsForm';
import { Heading } from '@/components/common/Heading';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function AutomoderatorFilterExemptionsPage() {
	return (
		<div className="flex flex-col gap-4">
			<DashboardCrumbs />
			<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
				<Heading subtitle="Channels the URL and invite filters leave alone" title="Filter Exemptions" />
				<RefreshServerDataButton for_bot="AUTOMODERATOR" />
			</div>
			<FilterExemptionsForm />
		</div>
	);
}
