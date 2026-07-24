import { DashboardCrumbs } from '../../../_components/DashboardCrumbs';
import { RefreshServerDataButton } from '../../ama/amas/new/_components/RefreshServerDataButton';
import { CategoriesList } from './_components/CategoriesList';
import { Heading } from '@/components/common/Heading';

export default function ModmailCategoriesPage() {
	return (
		<>
			<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
				<DashboardCrumbs />
				<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
					<Heading subtitle="Categories users pick when opening a ticket" title="ModMail Categories" />
					<RefreshServerDataButton for_bot="MODMAIL" />
				</div>
			</div>

			<div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 lg:grid-cols-3">
				<CategoriesList />
			</div>
		</>
	);
}
