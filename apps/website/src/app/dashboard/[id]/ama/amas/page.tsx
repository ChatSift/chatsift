import { DashboardCrumbs } from '../../../_components/DashboardCrumbs';
import { Heading } from '@/components/common/Heading';

export default async function AMAPage({ params }: PageProps<'/dashboard/[id]/ama/amas'>) {
	const { id } = await params;

	return (
		<div className="space-y-8">
			<div className="flex flex-col gap-4">
				<DashboardCrumbs segments={[{ label: 'AMA Bot', href: `/dashboard/${id}/ama` }, { label: 'AMA Sessions' }]} />
				<Heading subtitle="Create, edit, and manage AMAs in your community" title="AMA sessions" />
			</div>
		</div>
	);
}
