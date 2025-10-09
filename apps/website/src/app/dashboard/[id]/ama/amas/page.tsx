import { DashboardCrumbs } from '../../../_components/DashboardCrumbs';
import { AMASessionsList } from './_components/AMASessionsList';
import { Heading } from '@/components/common/Heading';
import { SearchBar } from '@/components/common/SearchBar';

export default async function AMAMangementPage({ params }: PageProps<'/dashboard/[id]/ama/amas'>) {
	const { id } = await params;

	return (
		<>
			<div className="flex flex-col [&:not]:first-of-type:mt-8 [&>*]:first-of-type:mb-4">
				<DashboardCrumbs segments={[{ label: 'AMA Bot', href: `/dashboard/${id}/ama` }, { label: 'AMA Sessions' }]} />
				<Heading subtitle="Create, edit, and manage AMAs in your community" title="AMA sessions" />
				<SearchBar placeholder="Search AMA sessions..." />
			</div>

			<AMASessionsList guildId={id} />
		</>
	);
}
