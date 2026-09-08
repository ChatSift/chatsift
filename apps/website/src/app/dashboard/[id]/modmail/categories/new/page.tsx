import { Heading } from '@chatsift/web-core/components/Heading';
import { CreateCategoryForm } from './_components/CreateCategoryForm';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function NewModmailCategoryPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<DashboardCrumbs />
			<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
				<Heading subtitle="Add a category users can pick when opening a ticket" title="New Category" />
				<RefreshServerDataButton for_bot="MODMAIL" />
			</div>
			<CreateCategoryForm />
		</div>
	);
}
