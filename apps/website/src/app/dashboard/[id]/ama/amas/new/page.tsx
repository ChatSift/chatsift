import { DashboardCrumbs } from '../../../../_components/DashboardCrumbs';
import { Heading } from '@/components/common/Heading';

export default async function AMAMangementPage({ params }: PageProps<'/dashboard/[id]/ama/amas/new'>) {
	const { id } = await params;

	return (
		<div className="flex flex-col [&:not]:first-of-type:mt-8 [&>*]:first-of-type:mb-4">
			<DashboardCrumbs
				segments={[
					{ label: 'AMA Bot', href: `/dashboard/${id}/ama` },
					{ label: 'AMA Sessions', href: `/dashboard/${id}/ama/amas` },
					{ label: 'New' },
				]}
			/>
			<Heading subtitle="Create a new AMA session" title="AMA sessions" />
		</div>
	);
}
