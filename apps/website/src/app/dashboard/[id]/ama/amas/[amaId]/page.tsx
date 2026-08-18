import { AMADetails } from './_components/AMADetails';
import { Heading } from '@/components/common/Heading';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { AMADashboardCrumbs } from '@/components/dashboard/AMADashboardCrumbs';

export default function AMADetailPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<AMADashboardCrumbs />
			<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
				<Heading subtitle="View and manage this AMA session" title="AMA Session Details" />
				<RefreshServerDataButton for_bot="AMA" />
			</div>
			<AMADetails />
		</div>
	);
}
