import { AMADashboardCrumbs } from '../../_components/AMADashboardCrumbs';
import { CreateAMAForm } from './_components/CreateAMAForm';
import { RefreshServerDataButton } from './_components/RefreshServerDataButton';
import { Heading } from '@/components/common/Heading';

export default function NewAMAPage() {
	return (
		<div className="flex flex-col [&:not]:first-of-type:mt-8 [&>*]:first-of-type:mb-4">
			<AMADashboardCrumbs />
			<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
				<Heading subtitle="Create a new AMA session" title="AMA sessions" />
				<RefreshServerDataButton for_bot="AMA" />
			</div>
			<CreateAMAForm />
		</div>
	);
}
