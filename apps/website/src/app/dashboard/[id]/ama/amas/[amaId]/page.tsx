import { AMADashboardCrumbs } from '../../_components/AMADashboardCrumbs';
import { AMADetails } from './_components/AMADetails';
import { Heading } from '@/components/common/Heading';

export default function AMADetailPage() {
	return (
		<div className="flex flex-col [&:not]:first-of-type:mt-8 [&>*]:first-of-type:mb-4">
			<AMADashboardCrumbs />
			<Heading subtitle="View and manage this AMA session" title="AMA Session Details" />
			<AMADetails />
		</div>
	);
}
