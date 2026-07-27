import { EditSnippetFormLoader } from './_components/EditSnippetForm';
import { Heading } from '@/components/common/Heading';
import { ModmailSnippetCrumbs } from '@/components/dashboard/ModmailSnippetCrumbs';

export default function EditModmailSnippetPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<ModmailSnippetCrumbs />
			<Heading subtitle="Edit an existing snippet" title="Edit Snippet" />
			<EditSnippetFormLoader />
		</div>
	);
}
