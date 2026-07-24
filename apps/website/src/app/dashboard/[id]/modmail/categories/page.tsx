import { DashboardCrumbs } from '../../../_components/DashboardCrumbs';
import { CategoriesList } from './_components/CategoriesList';
import { Heading } from '@/components/common/Heading';

export default function ModmailCategoriesPage() {
	return (
		<>
			<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
				<DashboardCrumbs />
				<Heading subtitle="Categories users pick when opening a ticket" title="ModMail Categories" />
			</div>

			<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
				<CategoriesList />
			</div>
		</>
	);
}
