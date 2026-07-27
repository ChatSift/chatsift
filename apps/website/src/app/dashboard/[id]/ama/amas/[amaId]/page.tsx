import { AMADetails } from './_components/AMADetails';
import { Heading } from '@/components/common/Heading';
import { AMADashboardCrumbs } from '@/components/dashboard/AMADashboardCrumbs';

export default function AMADetailPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<AMADashboardCrumbs />
			<Heading subtitle="View and manage this AMA session" title="AMA Session Details" />
			<AMADetails />
		</div>
	);
}
