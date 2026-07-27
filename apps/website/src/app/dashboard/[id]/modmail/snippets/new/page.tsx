import { CreateSnippetForm } from './_components/CreateSnippetForm';
import { Heading } from '@/components/common/Heading';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function NewModmailSnippetPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<DashboardCrumbs />
			<Heading subtitle="Add a canned response staff can use in a ticket" title="New Snippet" />
			<CreateSnippetForm />
		</div>
	);
}
