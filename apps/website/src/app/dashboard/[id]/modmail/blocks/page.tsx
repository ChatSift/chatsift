import { DashboardCrumbs } from '../../../_components/DashboardCrumbs';
import { BlocksList } from './_components/BlocksList';
import { Heading } from '@/components/common/Heading';

export default function ModmailBlocksPage() {
	return (
		<>
			<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
				<DashboardCrumbs />
				<Heading subtitle="Users blocked from opening new ModMail tickets" title="ModMail Blocks" />
			</div>

			<div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 lg:grid-cols-3">
				<BlocksList />
			</div>
		</>
	);
}
