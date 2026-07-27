import { EditCategoryFormLoader } from './_components/EditCategoryForm';
import { Heading } from '@/components/common/Heading';
import { RefreshServerDataButton } from '@/components/common/RefreshServerDataButton';
import { ModmailCategoryCrumbs } from '@/components/dashboard/ModmailCategoryCrumbs';

export default function EditModmailCategoryPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<ModmailCategoryCrumbs />
			<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
				<Heading subtitle="Edit an existing category" title="Edit Category" />
				<RefreshServerDataButton for_bot="MODMAIL" />
			</div>
			<EditCategoryFormLoader />
		</div>
	);
}
