import { DashboardCrumbs } from '../../../../_components/DashboardCrumbs';
import { Heading } from '@/components/common/Heading';

export default function AMAMangementPage() {
	return (
		<div className="flex flex-col [&:not]:first-of-type:mt-8 [&>*]:first-of-type:mb-4">
			<DashboardCrumbs />
			<Heading subtitle="Create a new AMA session" title="AMA sessions" />
		</div>
	);
}
